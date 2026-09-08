"""Deterministic edital text extraction.

Downloads every active PDF document of a procurement (edital, TR, anexos,
minuta) and extracts their text with pypdf, persisting the result in
`procurement_document_texts` (joined text) and `procurement_document_pages`
(one row per page) so the enrichment/analysis worker never re-downloads and
any future re-run reuses it. Scanned PDFs (image-only) come out as
`method='insufficient'` after pypdf; we then try Tesseract OCR (`ocr_pdf`) on
the same bytes and re-classify with the same quality gate. Success persists
`method='ocr'`. When OCR is unavailable (no `tesseract` binary) or still
doesn't clear the gate, the row stays `method='insufficient'` and is the
marker that routes it to the multimodal doc tier in the worker as a last
resort.

Cached `insufficient` rows are retried through OCR exactly once per
procurement run: since the PDF bytes aren't stored, the document is
re-downloaded, OCR'd, and upserted. To avoid retrying forever on documents
where OCR itself fails (missing binary, timeout, garbled scan), a failed OCR
attempt is persisted as `method='insufficient'` with `chars=-1` — this is the
"OCR already tried, don't retry" marker. Any other `insufficient` row (i.e.
`chars >= 0`) is still eligible for another OCR attempt.

A cached `pypdf`/`ocr` row written before per-page persistence existed has no
matching `procurement_document_pages` rows; it is treated like the OCR-retry
case and re-extracted so pages get written.
"""

from __future__ import annotations

import logging
import os
import shutil
import subprocess
import tempfile
from io import BytesIO
from pathlib import Path
from typing import Any

import httpx
import psycopg
import pypdfium2 as pdfium
from pypdf import PdfReader

logger = logging.getLogger(__name__)

DEFAULT_MAX_TOTAL_BYTES = 60 * 1024 * 1024  # 60 MB combined
MAX_TEXT_CHARS = 200_000
MIN_CHARS_PER_PAGE = 200
MIN_TOTAL_CHARS = 500
DOWNLOAD_TIMEOUT = 60.0
MAX_OCR_PAGES = 40
OCR_DPI = 200
OCR_PAGE_TIMEOUT = 60.0

_ocr_binary_missing_logged = False


def max_total_bytes() -> int:
    """Combined byte cap for a procurement's active PDFs, from
    `LIXTO_ANALYZE_MAX_BYTES` (bytes; default 60 MB). Read lazily so the
    module stays importable without the env var set."""
    raw = os.environ.get("LIXTO_ANALYZE_MAX_BYTES")
    if not raw:
        return DEFAULT_MAX_TOTAL_BYTES
    return int(raw)


# Edital first (type_id 2 is the PNCP "Edital" document type), then whatever
# else the órgão attached, by sequence.
_SELECT_DOCS_SQL = """
SELECT sequence, title, type_id, type_name, url, published_at
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

_SELECT_PAGES_SQL = """
SELECT page, text
FROM procurement_document_pages
WHERE procurement_id = %(procurement_id)s AND sequence = %(sequence)s
ORDER BY page
"""

_DELETE_PAGES_SQL = """
DELETE FROM procurement_document_pages
WHERE procurement_id = %s AND sequence = %s
"""

_INSERT_PAGE_SQL = """
INSERT INTO procurement_document_pages (procurement_id, sequence, page, text)
VALUES (%s, %s, %s, %s)
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


def extract_text(pdf_bytes: bytes) -> tuple[list[str], int]:
    """Returns (page_texts, page_count) for a PDF: one string per page.
    Raises on unparseable input — the caller maps that to method='failed'."""
    reader = PdfReader(BytesIO(pdf_bytes))
    pages = reader.pages
    page_texts = [(page.extract_text() or "") for page in pages]
    return page_texts, len(pages)


def classify_extraction(text: str, pages: int) -> str:
    """'pypdf' when the extracted text is dense enough to enrich from,
    'insufficient' otherwise (typically a scanned/image-only edital)."""
    if len(text) < MIN_TOTAL_CHARS or pages <= 0:
        return "insufficient"
    if len(text) / pages < MIN_CHARS_PER_PAGE:
        return "insufficient"
    return "pypdf"


def ocr_pdf(pdf_bytes: bytes) -> tuple[list[str], int]:
    """Renders up to MAX_OCR_PAGES pages at OCR_DPI with pypdfium2 and runs
    Tesseract (`por`) on each as a PNG. Returns (page_texts, pages_rendered)
    — ([], 0) when the `tesseract` binary isn't installed (logged once) or
    every page failed to render."""
    global _ocr_binary_missing_logged
    tesseract = shutil.which("tesseract")
    if tesseract is None:
        if not _ocr_binary_missing_logged:
            logger.warning("tesseract binary not found on PATH; OCR disabled")
            _ocr_binary_missing_logged = True
        return [], 0

    pdf = pdfium.PdfDocument(pdf_bytes)
    scale = OCR_DPI / 72
    page_texts: list[str] = []
    pages_rendered = 0
    try:
        for index, page in enumerate(pdf):
            if index >= MAX_OCR_PAGES:
                break
            try:
                image = page.render(scale=scale).to_pil()
            except Exception:
                logger.warning("failed to render page %d for OCR", index, exc_info=True)
                continue
            pages_rendered += 1
            with tempfile.TemporaryDirectory() as tmpdir:
                png_path = Path(tmpdir) / f"page-{index}.png"
                image.save(png_path)
                try:
                    result = subprocess.run(
                        [tesseract, str(png_path), "stdout", "-l", "por", "--psm", "6"],
                        capture_output=True,
                        timeout=OCR_PAGE_TIMEOUT,
                        check=True,
                    )
                except Exception:
                    logger.warning("tesseract failed on page %d", index, exc_info=True)
                    continue
                page_texts.append(result.stdout.decode("utf-8", errors="replace"))
    finally:
        close = getattr(pdf, "close", None)
        if callable(close):
            close()

    return page_texts, pages_rendered


def _maybe_ocr(row: dict[str, Any], pdf_bytes: bytes) -> None:
    """When `row['method']` is 'insufficient', tries OCR on the same bytes
    and mutates `row` in place: promotes it to method='ocr' when OCR clears
    the quality gate (setting `page_texts` to the OCR'd pages), otherwise
    marks chars=-1 as the "OCR already tried" marker so the row isn't
    retried on a future run. No-op (and no marker) when the tesseract
    binary isn't installed, so it's retried once it is."""
    if row["method"] != "insufficient":
        return
    if shutil.which("tesseract") is None:
        return

    page_texts, pages = ocr_pdf(pdf_bytes)
    joined = "\n\n".join(page_texts)[:MAX_TEXT_CHARS]
    if pages and classify_extraction(joined, pages) == "pypdf":
        row["method"] = "ocr"
        row["pages"] = pages
        row["chars"] = len(joined)
        row["text"] = joined
        row["page_texts"] = page_texts
    else:
        row["chars"] = -1
        row["text"] = None
        row["page_texts"] = None


def pick_documents(conn: psycopg.Connection, procurement_id: int) -> list[dict[str, Any]]:
    with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(_SELECT_DOCS_SQL, {"procurement_id": procurement_id})
        return cur.fetchall()


def _existing_texts(conn: psycopg.Connection, procurement_id: int) -> dict[int, dict[str, Any]]:
    with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(_SELECT_TEXTS_SQL, {"procurement_id": procurement_id})
        return {row["sequence"]: row for row in cur.fetchall()}


def _existing_pages(
    conn: psycopg.Connection, procurement_id: int, sequence: int
) -> list[str] | None:
    """Cached per-page text for a document, ordered by page, or None when no
    page rows exist yet (e.g. extracted before this ticket)."""
    with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(_SELECT_PAGES_SQL, {"procurement_id": procurement_id, "sequence": sequence})
        rows = cur.fetchall()
    if not rows:
        return None
    return [row["text"] for row in rows]


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
                # pypdf (and occasionally OCR) can emit NUL bytes, which
                # PostgreSQL text columns reject outright.
                "text": _strip_nul(row["text"]),
            },
        )


def _persist_pages(
    conn: psycopg.Connection, procurement_id: int, sequence: int, page_texts: list[str]
) -> None:
    """Replaces the per-page rows of one document: delete then insert every
    page (1-based), empty pages stored as ''."""
    with conn.cursor() as cur:
        cur.execute(_DELETE_PAGES_SQL, (procurement_id, sequence))
        cur.executemany(
            _INSERT_PAGE_SQL,
            [
                (procurement_id, sequence, page, _strip_nul(text) or "")
                for page, text in enumerate(page_texts, start=1)
            ],
        )


def _save_document(conn: psycopg.Connection, procurement_id: int, row: dict[str, Any]) -> None:
    """Persists the extracted text and, for pypdf/ocr rows, the per-page
    text, in the same commit."""
    _upsert(conn, procurement_id, row)
    if row["method"] in ("pypdf", "ocr"):
        _persist_pages(conn, procurement_id, row["sequence"], row.get("page_texts") or [])
    conn.commit()


def _strip_nul(text: str | None) -> str | None:
    """Drop what PostgreSQL's text type cannot store: NUL bytes and lone
    surrogate code points (both show up in pypdf output of broken PDFs)."""
    if not text:
        return text
    return text.replace("\x00", "").encode("utf-8", "ignore").decode("utf-8")


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
    """Extracts (or reuses) the text of every active PDF document of a
    procurement, stopping once `max_total_bytes()` of freshly downloaded
    content is exceeded (documents skipped by the cap get no row).

    Returns one dict per processed document with keys sequence, method,
    pages, chars, text, page_texts (list[str] | None), title, type_id,
    published_at, url and pdf_bytes — the latter is the freshly downloaded
    content, or None when the row was reused from the DB (the PDF tier
    re-downloads in that case).
    """
    docs = pick_documents(conn, procurement_id)
    existing = _existing_texts(conn, procurement_id) if docs else {}
    byte_cap = max_total_bytes()

    results: list[dict[str, Any]] = []
    total_bytes = 0

    for doc in docs:
        seq = doc.get("sequence")

        cached = existing.get(seq)
        # method='insufficient' with chars=-1 means OCR was already tried and
        # failed; anything else 'insufficient' falls through to re-download
        # + OCR. A cached 'pypdf'/'ocr' row without page rows (extracted
        # before per-page persistence existed) is re-extracted the same way
        # so pages get written.
        retry_with_ocr = (
            cached is not None and cached["method"] == "insufficient" and cached["chars"] != -1
        )
        cached_pages: list[str] | None = None
        stale_cache = False
        if cached is not None and cached["method"] in ("pypdf", "ocr"):
            cached_pages = _existing_pages(conn, procurement_id, seq)
            stale_cache = cached_pages is None

        if cached is not None and not retry_with_ocr and not stale_cache:
            results.append(
                {
                    "sequence": seq,
                    "method": cached["method"],
                    "pages": cached["pages"],
                    "chars": cached["chars"],
                    "text": cached["text"],
                    "page_texts": cached_pages,
                    "title": doc.get("title"),
                    "type_id": doc.get("type_id"),
                    "published_at": doc.get("published_at"),
                    "url": doc.get("url"),
                    "pdf_bytes": None,
                }
            )
            continue

        if total_bytes > byte_cap:
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
            "page_texts": None,
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
                        page_texts, pages = extract_text(content)
                    except Exception:
                        logger.warning("failed to parse PDF %s", url, exc_info=True)
                        row["method"] = "failed"
                    else:
                        joined = "\n\n".join(page_texts)[:MAX_TEXT_CHARS]
                        # Text is stored even when 'insufficient': it is cheap
                        # and still useful as a hint for the worker.
                        row["method"] = classify_extraction(joined, pages)
                        row["pages"] = pages
                        row["chars"] = len(joined)
                        row["text"] = joined
                        row["page_texts"] = page_texts
                        _maybe_ocr(row, content)

        _save_document(conn, procurement_id, row)
        results.append(
            {
                **row,
                "title": doc.get("title"),
                "type_id": doc.get("type_id"),
                "published_at": doc.get("published_at"),
                "url": url,
                "pdf_bytes": pdf_bytes,
            }
        )

    return results
