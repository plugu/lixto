"""Unit tests for src/lixto/enrich/documents.py.

Fully mocked psycopg connection/cursors and httpx client — no network, no
live database. The only real I/O is an in-memory PDF built with
pypdf.PdfWriter.
"""

from io import BytesIO
from unittest.mock import MagicMock

import httpx
import pytest
from pypdf import PdfWriter
from pypdf.errors import PdfReadError

from lixto.enrich.documents import (
    MAX_DOCS,
    classify_extraction,
    extract_for_procurement,
    extract_text,
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


def test_extract_text_on_blank_pdf_returns_empty_text_and_page_count():
    text, pages = extract_text(_blank_pdf_bytes(1))
    assert pages == 1
    assert text.strip() == ""
    assert classify_extraction(text, pages) == "insufficient"


def test_extract_text_raises_on_garbage():
    """Unparseable bytes must propagate; extract_for_procurement maps that to
    method='failed' rather than swallowing it here."""
    with pytest.raises(PdfReadError):
        extract_text(b"not a pdf at all")


# --- extract_for_procurement ----------------------------------------------


def _doc(seq=1, url="https://pncp/doc1"):
    return {
        "sequence": seq,
        "title": "Edital",
        "type_id": 2,
        "type_name": "Edital",
        "url": url,
    }


def _pdf_response(content=None):
    resp = MagicMock()
    resp.headers = {"content-type": "application/pdf"}
    resp.content = content if content is not None else _blank_pdf_bytes(1)
    resp.raise_for_status.return_value = None
    return resp


def _conn(docs, texts):
    """Cursor order inside extract_for_procurement: pick_documents,
    _existing_texts, then one upsert cursor per processed document."""
    docs_cur = MagicMock()
    docs_cur.fetchall.return_value = docs
    texts_cur = MagicMock()
    texts_cur.fetchall.return_value = texts
    upsert_curs = [MagicMock() for _ in range(4)]

    conn = MagicMock()
    conn.cursor.return_value.__enter__.side_effect = [docs_cur, texts_cur, *upsert_curs]
    conn.cursor.return_value.__exit__.return_value = False
    return conn, upsert_curs


def _http_client(responses_by_url):
    client = MagicMock(spec=httpx.Client)

    def _get(url, timeout=None, follow_redirects=None):
        resp = responses_by_url[url]
        if isinstance(resp, Exception):
            raise resp
        return resp

    client.get.side_effect = _get
    return client


def test_extract_for_procurement_reuses_cached_row_and_downloads_the_other():
    cached = {
        "sequence": 1,
        "method": "pypdf",
        "pages": 12,
        "chars": 5000,
        "text": "texto do edital",
    }
    conn, upsert_curs = _conn([_doc(1), _doc(2, "https://pncp/doc2")], [cached])
    client = _http_client({"https://pncp/doc2": _pdf_response()})

    rows = extract_for_procurement(conn, 42, client)

    assert len(rows) == 2
    assert client.get.call_count == 1  # cached doc not re-downloaded

    reused, fresh = rows
    assert reused["method"] == "pypdf"
    assert reused["text"] == "texto do edital"
    assert reused["pdf_bytes"] is None

    assert fresh["sequence"] == 2
    assert fresh["method"] == "insufficient"  # blank page -> no text
    assert fresh["pages"] == 1
    assert fresh["pdf_bytes"] is not None

    upserted = [c for c in upsert_curs if c.execute.call_args is not None]
    assert len(upserted) == 1  # only the freshly downloaded document
    sql, params = upserted[0].execute.call_args.args
    assert "INSERT INTO procurement_document_texts" in sql
    assert params["procurement_id"] == 42
    assert params["sequence"] == 2
    assert params["method"] == "insufficient"
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
    assert all(r["chars"] == 0 and r["text"] is None for r in rows)


def test_extract_for_procurement_processes_at_most_max_docs():
    conn, _ = _conn([_doc(i, f"https://pncp/doc{i}") for i in range(1, 5)], [])
    client = _http_client({f"https://pncp/doc{i}": _pdf_response() for i in range(1, 5)})

    rows = extract_for_procurement(conn, 42, client)

    assert len(rows) == MAX_DOCS
    assert client.get.call_count == MAX_DOCS


def test_extract_for_procurement_without_documents_does_nothing():
    conn, _ = _conn([], [])
    client = _http_client({})

    assert extract_for_procurement(conn, 42, client) == []
    client.get.assert_not_called()


def test_pick_documents_orders_edital_first_and_filters_inactive():
    conn = MagicMock()
    cur = MagicMock()
    cur.fetchall.return_value = [_doc()]
    conn.cursor.return_value.__enter__.return_value = cur

    docs = pick_documents(conn, 42)

    assert docs == [_doc()]
    sql, params = cur.execute.call_args.args
    assert "FROM procurement_documents" in sql
    assert "is_active IS TRUE" in sql
    assert "type_id = 2" in sql
    assert "title ILIKE '%%edital%%'" in sql
    assert params == {"procurement_id": 42}
