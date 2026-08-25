"""Deterministic edital text extraction (cycle 16, ticket 63).

Downloads up to MAX_DOCS edital PDFs per licitação and extracts their text
with pypdf, persisting the result in `documento_texto` so the enrichment
worker never re-downloads and any future re-enrichment reuses it. Scanned
PDFs (image-only) come out as `metodo='insuficiente'`, which is the marker
that routes them to the multimodal tier in ticket 64 — no OCR here.
"""

from __future__ import annotations

import logging
from io import BytesIO
from typing import Any

import httpx
import psycopg
from pypdf import PdfReader

logger = logging.getLogger(__name__)

MAX_DOCS = 2
MAX_TOTAL_BYTES = 30 * 1024 * 1024  # 30 MB combined
MAX_TEXT_CHARS = 200_000
MIN_CHARS_PER_PAGE = 200
MIN_TOTAL_CHARS = 500
DOWNLOAD_TIMEOUT = 60.0

# Copy of agents/deep.py::_SELECT_DOCS_SQL (edital first, active only).
# Deliberately duplicated: importing agents.deep would load
# company_profile.md, which the enrichment path must not depend on.
_SELECT_DOCS_SQL = """
SELECT sequencial_documento, titulo, tipo_documento_id, tipo_documento_nome, url
FROM documento
WHERE numero_controle_pncp = %(numero)s
  AND status_ativo IS TRUE
ORDER BY
    CASE WHEN tipo_documento_id = 2 THEN 0
         WHEN tipo_documento_nome ILIKE '%%edital%%' THEN 0
         WHEN titulo ILIKE '%%edital%%' THEN 0
         ELSE 1
    END,
    sequencial_documento ASC
"""

_SELECT_TEXTOS_SQL = """
SELECT sequencial_documento, metodo, paginas, chars, texto
FROM documento_texto
WHERE numero_controle_pncp = %(numero)s
"""

_UPSERT_TEXTO_SQL = """
INSERT INTO documento_texto (
    numero_controle_pncp, sequencial_documento, metodo, paginas, chars, texto, extraido_em
) VALUES (
    %(numero)s, %(sequencial_documento)s, %(metodo)s, %(paginas)s, %(chars)s, %(texto)s, now()
)
ON CONFLICT (numero_controle_pncp, sequencial_documento) DO UPDATE
SET metodo = EXCLUDED.metodo,
    paginas = EXCLUDED.paginas,
    chars = EXCLUDED.chars,
    texto = EXCLUDED.texto,
    extraido_em = now()
"""


def extract_text(pdf_bytes: bytes) -> tuple[str, int]:
    """Returns (text, page_count) for a PDF. Raises on unparseable input —
    the caller maps that to metodo='falha'."""
    reader = PdfReader(BytesIO(pdf_bytes))
    pages = reader.pages
    text = "\n\n".join((page.extract_text() or "") for page in pages)
    return text[:MAX_TEXT_CHARS], len(pages)


def classify_extraction(text: str, paginas: int) -> str:
    """'pypdf' when the extracted text is dense enough to enrich from,
    'insuficiente' otherwise (typically a scanned/image-only edital)."""
    if len(text) < MIN_TOTAL_CHARS or paginas <= 0:
        return "insuficiente"
    if len(text) / paginas < MIN_CHARS_PER_PAGE:
        return "insuficiente"
    return "pypdf"


def pick_documents(conn: psycopg.Connection, numero: str) -> list[dict[str, Any]]:
    with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(_SELECT_DOCS_SQL, {"numero": numero})
        return cur.fetchall()


def _existing_textos(conn: psycopg.Connection, numero: str) -> dict[int, dict[str, Any]]:
    with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(_SELECT_TEXTOS_SQL, {"numero": numero})
        return {row["sequencial_documento"]: row for row in cur.fetchall()}


def _upsert(conn: psycopg.Connection, numero: str, row: dict[str, Any]) -> None:
    with conn.cursor() as cur:
        cur.execute(
            _UPSERT_TEXTO_SQL,
            {
                "numero": numero,
                "sequencial_documento": row["sequencial_documento"],
                "metodo": row["metodo"],
                "paginas": row["paginas"],
                "chars": row["chars"],
                "texto": row["texto"],
            },
        )
    conn.commit()


def _download(url: str, http_client: httpx.Client) -> bytes | None:
    """Returns the PDF bytes, or None when the response isn't a PDF.
    Raises on transport/HTTP errors (caller maps to metodo='falha')."""
    resp = http_client.get(url, timeout=DOWNLOAD_TIMEOUT, follow_redirects=True)
    resp.raise_for_status()
    content = resp.content
    content_type = resp.headers.get("content-type", "")
    # PNCP mislabels many PDFs as application/octet-stream, so sniff the
    # magic bytes before rejecting (same rule as agents.deep.download_pdfs).
    if "pdf" in content_type.lower() or content.lstrip()[:5] == b"%PDF-":
        return content
    return None


def extract_for_licitacao(
    conn: psycopg.Connection, numero: str, http_client: httpx.Client
) -> list[dict[str, Any]]:
    """Extracts (or reuses) the text of up to MAX_DOCS edital documents.

    Returns one dict per processed document with keys sequencial_documento,
    metodo, paginas, chars, texto and pdf_bytes — the latter is the freshly
    downloaded content, or None when the row was reused from the DB (the
    Tier-2 PDF path in ticket 64 re-downloads in that case).
    """
    docs = pick_documents(conn, numero)
    existing = _existing_textos(conn, numero) if docs else {}

    results: list[dict[str, Any]] = []
    total_bytes = 0

    for doc in docs:
        if len(results) >= MAX_DOCS:
            break
        seq = doc.get("sequencial_documento")

        cached = existing.get(seq)
        if cached is not None:
            results.append(
                {
                    "sequencial_documento": seq,
                    "metodo": cached["metodo"],
                    "paginas": cached["paginas"],
                    "chars": cached["chars"],
                    "texto": cached["texto"],
                    "pdf_bytes": None,
                }
            )
            continue

        if total_bytes > MAX_TOTAL_BYTES:
            logger.info(
                "stopping extraction for %s: %d bytes already downloaded", numero, total_bytes
            )
            break

        url = doc.get("url")
        row: dict[str, Any] = {
            "sequencial_documento": seq,
            "metodo": "falha",
            "paginas": None,
            "chars": 0,
            "texto": None,
        }
        pdf_bytes: bytes | None = None

        if not url:
            logger.info("documento %s/%s has no url", numero, seq)
        else:
            try:
                content = _download(url, http_client)
            except Exception:
                logger.warning("failed to download document %s", url, exc_info=True)
                content = None
                row["metodo"] = "falha"
            else:
                if content is None:
                    row["metodo"] = "nao_pdf"
                else:
                    total_bytes += len(content)
                    pdf_bytes = content
                    try:
                        texto, paginas = extract_text(content)
                    except Exception:
                        logger.warning("failed to parse PDF %s", url, exc_info=True)
                        row["metodo"] = "falha"
                    else:
                        # Text is stored even when 'insuficiente': it is cheap
                        # and still useful as a hint for the worker.
                        row["metodo"] = classify_extraction(texto, paginas)
                        row["paginas"] = paginas
                        row["chars"] = len(texto)
                        row["texto"] = texto

        _upsert(conn, numero, row)
        results.append({**row, "pdf_bytes": pdf_bytes})

    return results
