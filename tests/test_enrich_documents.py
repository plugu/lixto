"""Unit tests for src/lixto/enrich/documents.py.

Fully mocked psycopg connection/cursors and httpx client — no network, no
live database. The only real I/O is an in-memory PDF built with
pypdf.PdfWriter.

The mocked connection (`_conn`) routes `cursor().execute(...).fetchall()` by
SQL substring rather than by call position, since a procurement can now mix
any number of cached/fresh/paged documents per run.
"""

from io import BytesIO
from unittest.mock import MagicMock

import httpx
import pytest
from PIL import Image
from pypdf import PdfWriter
from pypdf.errors import PdfReadError

from lixto.enrich import documents
from lixto.enrich.documents import (
    DEFAULT_MAX_TOTAL_BYTES,
    MAX_OCR_PAGES,
    classify_extraction,
    extract_for_procurement,
    extract_text,
    max_total_bytes,
    ocr_pdf,
    pick_documents,
)

# --- extraction classification -------------------------------------------


def test_classify_extraction_dense_text_is_pypdf():
    assert classify_extraction("x" * 3000, 3) == "pypdf"


def test_classify_extraction_sparse_text_is_insufficient():
    assert classify_extraction("x" * 200, 10) == "insufficient"
    assert classify_extraction("", 0) == "insufficient"
    assert classify_extraction("x" * 400, 1) == "insufficient"  # below MIN_TOTAL_CHARS


# --- extract_text ---------------------------------------------------------


def _blank_pdf_bytes(pages=1):
    writer = PdfWriter()
    for _ in range(pages):
        writer.add_blank_page(width=200, height=200)
    buf = BytesIO()
    writer.write(buf)
    return buf.getvalue()


def test_extract_text_on_blank_pdf_returns_page_texts_and_page_count():
    page_texts, pages = extract_text(_blank_pdf_bytes(2))
    assert pages == 2
    assert page_texts == ["", ""]
    assert classify_extraction("\n\n".join(page_texts), pages) == "insufficient"


def test_extract_text_raises_on_garbage():
    """Unparseable bytes must propagate; extract_for_procurement maps that to
    method='failed' rather than swallowing it here."""
    with pytest.raises(PdfReadError):
        extract_text(b"not a pdf at all")


# --- byte cap ---------------------------------------------------------


def test_max_total_bytes_defaults_and_reads_env(monkeypatch):
    monkeypatch.delenv("LIXTO_ANALYZE_MAX_BYTES", raising=False)
    assert max_total_bytes() == DEFAULT_MAX_TOTAL_BYTES == 60 * 1024 * 1024

    monkeypatch.setenv("LIXTO_ANALYZE_MAX_BYTES", "12345")
    assert max_total_bytes() == 12345


# --- extract_for_procurement ----------------------------------------------


def _doc(seq=1, url="https://pncp/doc1", published_at=None):
    return {
        "sequence": seq,
        "title": "Edital",
        "type_id": 2,
        "type_name": "Edital",
        "url": url,
        "published_at": published_at,
    }


def _pdf_response(content=None):
    resp = MagicMock()
    resp.headers = {"content-type": "application/pdf"}
    resp.content = content if content is not None else _blank_pdf_bytes(1)
    resp.raise_for_status.return_value = None
    return resp


class _FakeCursor:
    """A minimal cursor context manager that answers `fetchall()` based on
    the table named in the last executed SQL, and records every execute /
    executemany call for assertions."""

    def __init__(self, docs, texts, pages):
        self._docs = docs
        self._texts = texts
        self._pages = pages
        self.execute_calls: list[tuple[str, object]] = []
        self._last_sql = ""
        self._last_params = None

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, params=None):
        self._last_sql = sql
        self._last_params = params
        self.execute_calls.append((sql, params))

    def executemany(self, sql, seq):
        rows = list(seq)
        self._last_sql = sql
        self._last_params = rows
        self.execute_calls.append((sql, rows))

    def fetchall(self):
        sql = self._last_sql
        if "procurement_document_pages" in sql:
            seq = self._last_params["sequence"]
            return [{"page": p, "text": t} for p, t in self._pages.get(seq, [])]
        if "procurement_document_texts" in sql:
            return self._texts
        if "FROM procurement_documents" in sql:
            return self._docs
        raise AssertionError(f"unexpected query: {sql}")


def _conn(docs, texts, pages=None):
    """Mocked psycopg connection. `pages` maps sequence -> list[(page, text)]
    of cached `procurement_document_pages` rows."""
    pages = pages or {}
    cursors: list[_FakeCursor] = []

    def _make_cursor(*_args, **_kwargs):
        cur = _FakeCursor(docs, texts, pages)
        cursors.append(cur)
        return cur

    conn = MagicMock()
    conn.cursor.side_effect = _make_cursor
    return conn, cursors


def _executes(cursors, needle):
    return [c for c in cursors if any(needle in sql for sql, _ in c.execute_calls)]


def _http_client(responses_by_url):
    client = MagicMock(spec=httpx.Client)

    def _get(url, timeout=None, follow_redirects=None):
        resp = responses_by_url[url]
        if isinstance(resp, Exception):
            raise resp
        return resp

    client.get.side_effect = _get
    return client


def test_extract_for_procurement_reuses_cached_row_and_downloads_the_other(monkeypatch):
    # No tesseract for this test: the fresh doc's blank page must land
    # deterministically on method='insufficient' without an OCR detour.
    monkeypatch.setattr(documents.shutil, "which", lambda name: None)

    cached = {
        "sequence": 1,
        "method": "pypdf",
        "pages": 2,
        "chars": 20,
        "text": "texto pg1\n\ntexto pg2",
    }
    pages = {1: [(1, "texto pg1"), (2, "texto pg2")]}
    conn, cursors = _conn([_doc(1), _doc(2, "https://pncp/doc2")], [cached], pages)
    client = _http_client({"https://pncp/doc2": _pdf_response()})

    rows = extract_for_procurement(conn, 42, client)

    assert len(rows) == 2
    assert client.get.call_count == 1  # cached doc not re-downloaded

    reused, fresh = rows
    assert reused["method"] == "pypdf"
    assert reused["text"] == "texto pg1\n\ntexto pg2"
    assert reused["page_texts"] == ["texto pg1", "texto pg2"]
    assert reused["pdf_bytes"] is None
    assert reused["title"] == "Edital"
    assert reused["type_id"] == 2

    assert fresh["sequence"] == 2
    assert fresh["method"] == "insufficient"  # blank page -> no text
    assert fresh["pages"] == 1
    assert fresh["page_texts"] == [""]  # extracted but never persisted (not pypdf/ocr)
    assert fresh["pdf_bytes"] is not None

    inserted = _executes(cursors, "INSERT INTO procurement_document_texts")
    assert len(inserted) == 1  # only the freshly downloaded document
    _sql, params = inserted[0].execute_calls[0]
    assert params["procurement_id"] == 42
    assert params["sequence"] == 2
    assert params["method"] == "insufficient"
    assert _executes(cursors, "INSERT INTO procurement_document_pages") == []
    conn.commit.assert_called_once()


def test_extract_for_procurement_marks_non_pdf_and_download_failure():
    html = MagicMock()
    html.headers = {"content-type": "text/html"}
    html.content = b"<html></html>"
    html.raise_for_status.return_value = None

    conn, _ = _conn([_doc(1), _doc(2, "https://pncp/doc2")], [])
    client = _http_client(
        {
            "https://pncp/doc1": html,
            "https://pncp/doc2": httpx.ConnectError("boom"),
        }
    )

    rows = extract_for_procurement(conn, 42, client)

    assert [r["method"] for r in rows] == ["not_pdf", "failed"]
    assert all(r["chars"] == 0 and r["text"] is None and r["page_texts"] is None for r in rows)


def test_extract_for_procurement_processes_every_active_document():
    """MAX_DOCS is gone: 3 active documents produce 3 rows."""
    assert not hasattr(documents, "MAX_DOCS")

    docs = [_doc(i, f"https://pncp/doc{i}") for i in range(1, 4)]
    conn, _ = _conn(docs, [])
    client = _http_client({f"https://pncp/doc{i}": _pdf_response() for i in range(1, 4)})

    rows = extract_for_procurement(conn, 42, client)

    assert len(rows) == 3
    assert client.get.call_count == 3


def test_extract_for_procurement_without_documents_does_nothing():
    conn, _ = _conn([], [])
    client = _http_client({})

    assert extract_for_procurement(conn, 42, client) == []
    client.get.assert_not_called()


def test_extract_for_procurement_stops_when_byte_cap_from_env_is_exceeded(monkeypatch):
    monkeypatch.setenv("LIXTO_ANALYZE_MAX_BYTES", "10")

    docs = [_doc(i, f"https://pncp/doc{i}") for i in range(1, 4)]
    conn, _ = _conn(docs, [])
    content = _blank_pdf_bytes(1)  # well over 10 bytes
    client = _http_client({f"https://pncp/doc{i}": _pdf_response(content) for i in range(1, 4)})

    rows = extract_for_procurement(conn, 42, client)

    assert len(rows) == 1  # doc 1 downloaded, cap exceeded before doc 2
    assert client.get.call_count == 1


def test_extract_for_procurement_persists_page_texts_on_fresh_pypdf_extraction(monkeypatch):
    page_texts = ["x" * 1000, "y" * 1000, "z" * 1000]
    monkeypatch.setattr(documents, "extract_text", lambda _bytes: (page_texts, 3))

    conn, cursors = _conn([_doc(1)], [])
    client = _http_client({"https://pncp/doc1": _pdf_response(b"%PDF-1.4 whatever")})

    rows = extract_for_procurement(conn, 42, client)

    assert rows[0]["method"] == "pypdf"
    assert rows[0]["page_texts"] == page_texts
    assert rows[0]["published_at"] is None
    assert rows[0]["url"] == "https://pncp/doc1"

    page_cursors = _executes(cursors, "procurement_document_pages")
    assert len(page_cursors) == 1
    delete_sql, delete_params = page_cursors[0].execute_calls[0]
    insert_sql, insert_rows = page_cursors[0].execute_calls[1]
    assert "DELETE FROM procurement_document_pages" in delete_sql
    assert delete_params == (42, 1)
    assert "INSERT INTO procurement_document_pages" in insert_sql
    assert insert_rows == [
        (42, 1, 1, "x" * 1000),
        (42, 1, 2, "y" * 1000),
        (42, 1, 3, "z" * 1000),
    ]


def test_extract_for_procurement_cached_pypdf_without_pages_reextracts(monkeypatch):
    """A cached pypdf row written before per-page persistence existed (no
    `procurement_document_pages` rows) is re-downloaded and re-extracted."""
    cached = {"sequence": 1, "method": "pypdf", "pages": 2, "chars": 20, "text": "old cached text"}
    fresh_page_texts = ["fresh pg1 " + "x" * 1000, "fresh pg2 " + "x" * 1000]
    monkeypatch.setattr(documents, "extract_text", lambda _bytes: (fresh_page_texts, 2))

    conn, cursors = _conn([_doc(1)], [cached], pages={})  # no cached page rows
    client = _http_client({"https://pncp/doc1": _pdf_response()})

    rows = extract_for_procurement(conn, 42, client)

    assert client.get.call_count == 1  # re-downloaded despite the cached text row
    assert rows[0]["method"] == "pypdf"
    assert rows[0]["page_texts"] == fresh_page_texts

    assert len(_executes(cursors, "INSERT INTO procurement_document_texts")) == 1
    assert len(_executes(cursors, "INSERT INTO procurement_document_pages")) == 1


def test_pick_documents_orders_edital_first_and_filters_inactive():
    conn = MagicMock()
    cur = MagicMock()
    cur.fetchall.return_value = [_doc()]
    conn.cursor.return_value.__enter__.return_value = cur

    docs = pick_documents(conn, 42)

    assert docs == [_doc()]
    sql, params = cur.execute.call_args.args
    assert "FROM procurement_documents" in sql
    assert "published_at" in sql
    assert "is_active IS TRUE" in sql
    assert "type_id = 2" in sql
    assert "title ILIKE '%%edital%%'" in sql
    assert params == {"procurement_id": 42}


# --- OCR --------------------------------------------------------------


class _FakePage:
    def render(self, scale=None):
        return self

    def to_pil(self):
        return Image.new("RGB", (2, 2))


class _FakePdfDocument:
    def __init__(self, n_pages):
        self._n_pages = n_pages
        self.closed = False

    def __iter__(self):
        return iter(_FakePage() for _ in range(self._n_pages))

    def close(self):
        self.closed = True


def _patch_pdfium(monkeypatch, n_pages):
    monkeypatch.setattr(documents.pdfium, "PdfDocument", lambda _bytes: _FakePdfDocument(n_pages))


def _patch_tesseract_present(monkeypatch):
    monkeypatch.setattr(documents.shutil, "which", lambda name: "/usr/bin/tesseract")


def _patch_tesseract_ok(monkeypatch, page_text="x" * 300):
    _patch_tesseract_present(monkeypatch)

    def _run(cmd, **kwargs):
        result = MagicMock()
        result.stdout = page_text.encode()
        return result

    monkeypatch.setattr(documents.subprocess, "run", _run)


def _patch_tesseract_broken(monkeypatch):
    _patch_tesseract_present(monkeypatch)

    def _boom(cmd, **kwargs):
        raise RuntimeError("tesseract crashed")

    monkeypatch.setattr(documents.subprocess, "run", _boom)


def test_ocr_pdf_missing_binary_returns_empty_without_touching_pdfium(monkeypatch):
    monkeypatch.setattr(documents.shutil, "which", lambda name: None)
    pdfium_called = MagicMock()
    monkeypatch.setattr(documents.pdfium, "PdfDocument", pdfium_called)

    page_texts, pages = ocr_pdf(b"whatever")

    assert (page_texts, pages) == ([], 0)
    pdfium_called.assert_not_called()


def test_ocr_pdf_returns_one_string_per_page(monkeypatch):
    _patch_pdfium(monkeypatch, 2)
    _patch_tesseract_ok(monkeypatch, page_text="texto em português")

    page_texts, pages = ocr_pdf(b"%PDF-1.4 fake")

    assert pages == 2
    assert page_texts == ["texto em português", "texto em português"]


def test_ocr_pdf_respects_the_page_cap(monkeypatch):
    _patch_pdfium(monkeypatch, MAX_OCR_PAGES + 5)
    calls = []
    _patch_tesseract_present(monkeypatch)

    def _run(cmd, **kwargs):
        calls.append(cmd)
        result = MagicMock()
        result.stdout = b"x" * 300
        return result

    monkeypatch.setattr(documents.subprocess, "run", _run)

    page_texts, pages = ocr_pdf(b"%PDF-1.4 fake")

    assert pages == MAX_OCR_PAGES
    assert len(page_texts) == MAX_OCR_PAGES
    assert len(calls) == MAX_OCR_PAGES


def test_extract_for_procurement_promotes_insufficient_to_ocr_on_success(monkeypatch):
    _patch_pdfium(monkeypatch, 2)
    _patch_tesseract_ok(monkeypatch)

    conn, cursors = _conn([_doc(1)], [])
    client = _http_client({"https://pncp/doc1": _pdf_response(_blank_pdf_bytes(2))})

    rows = extract_for_procurement(conn, 42, client)

    assert rows[0]["method"] == "ocr"
    assert rows[0]["chars"] > 0
    assert rows[0]["pages"] == 2
    assert rows[0]["page_texts"] == ["x" * 300, "x" * 300]

    inserted = _executes(cursors, "INSERT INTO procurement_document_texts")
    assert len(inserted) == 1
    _, params = inserted[0].execute_calls[0]
    assert params["method"] == "ocr"
    assert params["chars"] > 0

    page_cursors = _executes(cursors, "procurement_document_pages")
    assert len(page_cursors) == 1
    _delete_sql, delete_params = page_cursors[0].execute_calls[0]
    _insert_sql, insert_rows = page_cursors[0].execute_calls[1]
    assert delete_params == (42, 1)
    assert insert_rows == [(42, 1, 1, "x" * 300), (42, 1, 2, "x" * 300)]


def test_extract_for_procurement_marks_ocr_failure_with_chars_negative_one(monkeypatch):
    _patch_pdfium(monkeypatch, 1)
    _patch_tesseract_broken(monkeypatch)

    conn, cursors = _conn([_doc(1)], [])
    client = _http_client({"https://pncp/doc1": _pdf_response(_blank_pdf_bytes(1))})

    rows = extract_for_procurement(conn, 42, client)

    assert rows[0]["method"] == "insufficient"
    assert rows[0]["chars"] == -1
    assert rows[0]["text"] is None
    assert rows[0]["page_texts"] is None

    inserted = _executes(cursors, "INSERT INTO procurement_document_texts")
    _, params = inserted[0].execute_calls[0]
    assert params["method"] == "insufficient"
    assert params["chars"] == -1
    assert _executes(cursors, "procurement_document_pages") == []


def test_extract_for_procurement_missing_tesseract_leaves_insufficient_untouched(monkeypatch):
    monkeypatch.setattr(documents.shutil, "which", lambda name: None)
    pdfium_called = MagicMock()
    monkeypatch.setattr(documents.pdfium, "PdfDocument", pdfium_called)

    conn, cursors = _conn([_doc(1)], [])
    client = _http_client({"https://pncp/doc1": _pdf_response(_blank_pdf_bytes(1))})

    rows = extract_for_procurement(conn, 42, client)

    assert rows[0]["method"] == "insufficient"
    assert rows[0]["chars"] == 0  # not the "already tried" marker
    assert rows[0]["page_texts"] == [""]  # extracted but never persisted (stays insufficient)
    pdfium_called.assert_not_called()

    inserted = _executes(cursors, "INSERT INTO procurement_document_texts")
    _, params = inserted[0].execute_calls[0]
    assert params["chars"] == 0
    assert _executes(cursors, "INSERT INTO procurement_document_pages") == []


def test_extract_for_procurement_does_not_retry_ocr_already_tried(monkeypatch):
    ocr_called = MagicMock()
    monkeypatch.setattr(documents, "ocr_pdf", ocr_called)

    cached = {"sequence": 1, "method": "insufficient", "pages": 1, "chars": -1, "text": None}
    conn, cursors = _conn([_doc(1)], [cached])
    client = _http_client({})

    rows = extract_for_procurement(conn, 42, client)

    assert rows[0]["method"] == "insufficient"
    assert rows[0]["chars"] == -1
    client.get.assert_not_called()
    ocr_called.assert_not_called()
    assert _executes(cursors, "INSERT INTO procurement_document_texts") == []
    assert _executes(cursors, "procurement_document_pages") == []


def test_extract_for_procurement_retries_stale_insufficient_cache_through_ocr(monkeypatch):
    """A cache written before OCR support existed (chars >= 0) is eligible
    for one retry: the document is re-downloaded and OCR'd, and its pages
    get persisted."""
    _patch_pdfium(monkeypatch, 1)
    _patch_tesseract_ok(monkeypatch, page_text="x" * 600)

    cached = {"sequence": 1, "method": "insufficient", "pages": 1, "chars": 0, "text": ""}
    conn, cursors = _conn([_doc(1)], [cached])
    client = _http_client({"https://pncp/doc1": _pdf_response(_blank_pdf_bytes(1))})

    rows = extract_for_procurement(conn, 42, client)

    assert client.get.call_count == 1
    assert rows[0]["method"] == "ocr"
    assert len(_executes(cursors, "INSERT INTO procurement_document_texts")) == 1
    assert len(_executes(cursors, "procurement_document_pages")) == 1


def test_upsert_strips_nul_bytes_before_persisting():
    """pypdf sometimes yields NUL bytes; Postgres text columns reject them."""
    conn = MagicMock()
    cur = conn.cursor.return_value.__enter__.return_value
    documents._upsert(
        conn,
        7,
        {"sequence": 1, "method": "pypdf", "pages": 2, "chars": 6, "text": "ab\x00cd\x00"},
    )
    params = cur.execute.call_args.args[1]
    assert params["text"] == "abcd"
    assert documents._strip_nul(None) is None
    assert documents._strip_nul("ok\udbc0x") == "okx"  # lone surrogate dropped


def test_persist_pages_deletes_then_inserts_every_page_stripping_nul():
    conn = MagicMock()
    cur = conn.cursor.return_value.__enter__.return_value
    documents._persist_pages(conn, 7, 1, ["pg1\x00", "", "pg3"])

    delete_sql, delete_params = cur.execute.call_args_list[0].args
    assert "DELETE FROM procurement_document_pages" in delete_sql
    assert delete_params == (7, 1)

    insert_sql, insert_rows = cur.executemany.call_args.args
    assert "INSERT INTO procurement_document_pages" in insert_sql
    assert insert_rows == [(7, 1, 1, "pg1"), (7, 1, 2, ""), (7, 1, 3, "pg3")]
