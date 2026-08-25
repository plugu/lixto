"""Deterministic edital text extraction.

Downloads up to MAX_DOCS edital PDFs per procurement and extracts their text
with pypdf, persisting the result in `procurement_document_texts` so the
enrichment worker never re-downloads and any future re-enrichment reuses it.
Scanned PDFs (image-only) come out as `method='insufficient'`, which is the
marker that routes them to the multimodal tier in the worker — no OCR here.
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

# Edital first (type_id 2 is the PNCP "Edital" document type), then whatever
# else the órgão attached, by sequence.
_SELECT_DOCS_SQL = """
SELECT sequence, title, type_id, type_name, url
FROM procurement_documents
WHERE procurement_id = %(procurement_id)s
  AND is_active IS TRUE
ORDER BY
    CASE WHEN type_id = 2 THEN 0
         WHEN type_name ILIKE '%%edital%%' THEN 0
         WHEN title ILIKE '%%edital%%' THEN 0
         ELSE 1
    END,
    sequence ASC
"""

_SELECT_TEXTS_SQL = """
SELECT sequence, method, pages, chars, text
FROM procurement_document_texts
WHERE procurement_id = %(procurement_id)s
"""

_UPSERT_TEXT_SQL = """
INSERT INTO procurement_document_texts (
    procurement_id, sequence, method, pages, chars, text, extracted_at
) VALUES (
    %(procurement_id)s, %(sequence)s, %(method)s, %(pages)s, %(chars)s, %(text)s, now()
)
ON CONFLICT (procurement_id, sequence) DO UPDATE
SET method = EXCLUDED.method,
    pages = EXCLUDED.pages,
    chars = EXCLUDED.chars,
    text = EXCLUDED.text,
    extracted_at = now()
"""


def extract_text(pdf_bytes: bytes) -> tuple[str, int]:
    """Returns (text, page_count) for a PDF. Raises on unparseable input —
    the caller maps that to method='failed'."""
    reader = PdfReader(BytesIO(pdf_bytes))
    pages = reader.pages
    text = "\n\n".join((page.extract_text() or "") for page in pages)
    return text[:MAX_TEXT_CHARS], len(pages)


def classify_extraction(text: str, pages: int) -> str:
    """'pypdf' when the extracted text is dense enough to enrich from,
    'insufficient' otherwise (typically a scanned/image-only edital)."""
    if len(text) < MIN_TOTAL_CHARS or pages <= 0:
        return "insufficient"
    if len(text) / pages < MIN_CHARS_PER_PAGE:
        return "insufficient"
    return "pypdf"


def pick_documents(conn: psycopg.Connection, procurement_id: int) -> list[dict[str, Any]]:
    with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(_SELECT_DOCS_SQL, {"procurement_id": procurement_id})
        return cur.fetchall()


def _existing_texts(conn: psycopg.Connection, procurement_id: int) -> dict[int, dict[str, Any]]:
    with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(_SELECT_TEXTS_SQL, {"procurement_id": procurement_id})
        return {row["sequence"]: row for row in cur.fetchall()}


def _upsert(conn: psycopg.Connection, procurement_id: int, row: dict[str, Any]) -> None:
    with conn.cursor() as cur:
        cur.execute(
            _UPSERT_TEXT_SQL,
            {
                "procurement_id": procurement_id,
                "sequence": row["sequence"],
                "method": row["method"],
                "pages": row["pages"],
                "chars": row["chars"],
                "text": row["text"],
            },
        )
    conn.commit()


def _download(url: str, http_client: httpx.Client) -> bytes | None:
    """Returns the PDF bytes, or None when the response isn't a PDF.
    Raises on transport/HTTP errors (caller maps to method='failed')."""
    resp = http_client.get(url, timeout=DOWNLOAD_TIMEOUT, follow_redirects=True)
    resp.raise_for_status()
    content = resp.content
    content_type = resp.headers.get("content-type", "")
    # PNCP mislabels many PDFs as application/octet-stream, so sniff the
    # magic bytes before rejecting.
    if "pdf" in content_type.lower() or content.lstrip()[:5] == b"%PDF-":
        return content
    return None


def extract_for_procurement(
    conn: psycopg.Connection, procurement_id: int, http_client: httpx.Client
) -> list[dict[str, Any]]:
    """Extracts (or reuses) the text of up to MAX_DOCS edital documents.

    Returns one dict per processed document with keys sequence, method,
    pages, chars, text and pdf_bytes — the latter is the freshly downloaded
    content, or None when the row was reused from the DB (the PDF tier
    re-downloads in that case).
    """
    docs = pick_documents(conn, procurement_id)
    existing = _existing_texts(conn, procurement_id) if docs else {}

    results: list[dict[str, Any]] = []
    total_bytes = 0

    for doc in docs:
        if len(results) >= MAX_DOCS:
            break
        seq = doc.get("sequence")

        cached = existing.get(seq)
        if cached is not None:
            results.append(
                {
                    "sequence": seq,
                    "method": cached["method"],
                    "pages": cached["pages"],
                    "chars": cached["chars"],
                    "text": cached["text"],
                    "pdf_bytes": None,
                }
            )
            continue

        if total_bytes > MAX_TOTAL_BYTES:
            logger.info(
                "stopping extraction for %s: %d bytes already downloaded",
                procurement_id,
                total_bytes,
            )
            break

        url = doc.get("url")
        row: dict[str, Any] = {
            "sequence": seq,
            "method": "failed",
            "pages": None,
            "chars": 0,
            "text": None,
        }
        pdf_bytes: bytes | None = None

        if not url:
            logger.info("document %s/%s has no url", procurement_id, seq)
        else:
            try:
                content = _download(url, http_client)
            except Exception:
                logger.warning("failed to download document %s", url, exc_info=True)
                content = None
                row["method"] = "failed"
            else:
                if content is None:
                    row["method"] = "not_pdf"
                else:
                    total_bytes += len(content)
                    pdf_bytes = content
                    try:
                        text, pages = extract_text(content)
                    except Exception:
                        logger.warning("failed to parse PDF %s", url, exc_info=True)
                        row["method"] = "failed"
                    else:
                        # Text is stored even when 'insufficient': it is cheap
                        # and still useful as a hint for the worker.
                        row["method"] = classify_extraction(text, pages)
                        row["pages"] = pages
                        row["chars"] = len(text)
                        row["text"] = text

        _upsert(conn, procurement_id, row)
        results.append({**row, "pdf_bytes": pdf_bytes})

    return results
