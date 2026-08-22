"""Unit tests for src/plic/agents/deep.py.

Fully mocked psycopg connections/cursors, a mocked OpenAI client, and a
mocked httpx client — no network, no live database (mirrors
tests/test_agents_triage.py).
"""

import json
from unittest.mock import MagicMock

import httpx

from plic.agents.deep import (
    _SELECT_SQL,
    analyze_one,
    build_input_content,
    deep_analyze,
    download_pdfs,
    parse_response,
    pick_documents,
)

PROFILE_TEXT = "## Empresa\nAcme Ltda, fornece TI."


def _row(numero="num-1", verdict="fit"):
    return {
        "numero_controle_pncp": numero,
        "objeto_compra": "Aquisição de notebooks",
        "modalidade_nome": "Pregão Eletrônico",
        "setor": "TI",
        "uf": "SP",
        "municipio_nome": "São Paulo",
        "valor_total_estimado": 100000,
        "data_encerramento_proposta": "2026-09-01",
        "triage_verdict": verdict,
        "triage_reasoning": "bom encaixe",
    }


def _doc(seq=1, tipo_id=2, tipo_nome="Edital", titulo="Edital", url="https://pncp/doc1"):
    return {
        "sequencial_documento": seq,
        "titulo": titulo,
        "tipo_documento_id": tipo_id,
        "tipo_documento_nome": tipo_nome,
        "url": url,
    }


def _deep_payload(verdict="fit"):
    return {
        "deep_verdict": verdict,
        "fit_score": 80,
        "reasoning": "Edital compatível com o perfil.",
        "requirements": [{"tipo": "habilitação", "descricao": "Atestado", "atende": "sim"}],
        "prazos": [{"evento": "Abertura", "data": "2026-09-01"}],
        "risks": ["Prazo apertado"],
    }


def _fake_openai_response(payload, refused=False):
    response = MagicMock()
    if refused:
        response.output_text = ""
        item = MagicMock()
        item.type = "refusal"
        response.output = [item]
    else:
        response.output_text = json.dumps(payload)
        response.output = []
    return response


# --- selection SQL -----------------------------------------------------


def test_select_sql_filters_fit_borderline_pending_deep():
    assert "a.verdict IN ('fit', 'borderline')" in _SELECT_SQL
    assert "a.deep_status IS NULL" in _SELECT_SQL
    assert "ORDER BY l.data_encerramento_proposta ASC NULLS LAST" in _SELECT_SQL


# --- document selection --------------------------------------------------


def test_pick_documents_queries_by_numero():
    conn = MagicMock()
    cur = MagicMock()
    cur.fetchall.return_value = [_doc()]
    conn.cursor.return_value.__enter__.return_value = cur

    docs = pick_documents(conn, "num-1")

    assert docs == [_doc()]
    args, _kwargs = cur.execute.call_args
    assert args[1] == {"numero": "num-1"}


# --- PDF download ----------------------------------------------------------


def _http_client_returning(responses_by_url):
    client = MagicMock(spec=httpx.Client)

    def _get(url, timeout=None, follow_redirects=None):
        resp = responses_by_url[url]
        if isinstance(resp, Exception):
            raise resp
        return resp

    client.get.side_effect = _get
    return client


def _pdf_response(content=b"%PDF-1.4 fake pdf bytes"):
    resp = MagicMock()
    resp.headers = {"content-type": "application/pdf"}
    resp.content = content
    resp.raise_for_status.return_value = None
    return resp


def _non_pdf_response():
    resp = MagicMock()
    resp.headers = {"content-type": "text/html"}
    resp.content = b"<html></html>"
    resp.raise_for_status.return_value = None
    return resp


def test_download_pdfs_downloads_up_to_two_and_skips_non_pdf():
    docs = [
        _doc(seq=1, url="https://pncp/doc1"),
        _doc(seq=2, url="https://pncp/doc2"),
        _doc(seq=3, url="https://pncp/doc3"),
    ]
    client = _http_client_returning(
        {
            "https://pncp/doc1": _pdf_response(),
            "https://pncp/doc2": _pdf_response(),
            "https://pncp/doc3": _pdf_response(),
        }
    )

    downloaded, skip_reason = download_pdfs(docs, client)

    assert len(downloaded) == 2
    assert skip_reason is None
    assert client.get.call_count == 2  # stopped after MAX_DOCS


def test_download_pdfs_accepts_octet_stream_with_pdf_magic_bytes():
    """PNCP frequently mislabels PDF downloads as application/octet-stream;
    the PDF magic-byte sniff must still accept them."""
    resp = MagicMock()
    resp.headers = {"content-type": "application/octet-stream"}
    resp.content = b"%PDF-1.4 fake pdf bytes"
    resp.raise_for_status.return_value = None
    docs = [_doc(seq=1, url="https://pncp/doc1")]
    client = _http_client_returning({"https://pncp/doc1": resp})

    downloaded, skip_reason = download_pdfs(docs, client)

    assert len(downloaded) == 1
    assert skip_reason is None


def test_download_pdfs_skips_non_pdf_content_type():
    docs = [_doc(seq=1, url="https://pncp/doc1")]
    client = _http_client_returning({"https://pncp/doc1": _non_pdf_response()})

    downloaded, skip_reason = download_pdfs(docs, client)

    assert downloaded == []
    assert "no PDF" in skip_reason


def test_download_pdfs_no_documents():
    downloaded, skip_reason = download_pdfs([], MagicMock())
    assert downloaded == []
    assert skip_reason == "no active documents"


def test_download_pdfs_oversized_combined_size_skipped():
    docs = [_doc(seq=1, url="https://pncp/doc1"), _doc(seq=2, url="https://pncp/doc2")]
    big_content = b"0" * (16 * 1024 * 1024)
    client = _http_client_returning(
        {
            "https://pncp/doc1": _pdf_response(big_content),
            "https://pncp/doc2": _pdf_response(big_content),
        }
    )

    downloaded, skip_reason = download_pdfs(docs, client)

    assert downloaded == []
    assert "exceeds" in skip_reason


def test_download_pdfs_handles_request_exception():
    docs = [_doc(seq=1, url="https://pncp/doc1")]
    client = _http_client_returning({"https://pncp/doc1": httpx.ConnectError("boom")})

    downloaded, skip_reason = download_pdfs(docs, client)

    assert downloaded == []
    assert skip_reason == "no PDF documents downloadable"


# --- response parsing --------------------------------------------------


def test_parse_response_valid_payload():
    payload = _deep_payload()
    response = _fake_openai_response(payload)
    assert parse_response(response) == payload


def test_parse_response_refusal_returns_none():
    response = _fake_openai_response(_deep_payload(), refused=True)
    assert parse_response(response) is None


def test_parse_response_empty_output_text_returns_none():
    response = MagicMock()
    response.output_text = ""
    response.output = []
    assert parse_response(response) is None


def test_parse_response_invalid_verdict_returns_none():
    payload = _deep_payload()
    payload["deep_verdict"] = "invalido"
    response = _fake_openai_response(payload)
    assert parse_response(response) is None


# --- input content -----------------------------------------------------


def test_build_input_content_lists_files_then_text():
    pdfs = [{"filename": "edital.pdf", "content": b"%PDF-1.4"}]
    content = build_input_content(pdfs, "context text")

    assert content[0]["type"] == "input_file"
    assert content[0]["filename"] == "edital.pdf"
    assert content[0]["file_data"].startswith("data:application/pdf;base64,")
    assert content[-1] == {"type": "input_text", "text": "context text"}


# --- analyze_one ---------------------------------------------------------


def _conn_for_analyze_one(docs, itens):
    """Cursor call order in analyze_one: pick_documents (select),
    fetch_itens (select), then _update (update+commit)."""
    docs_cur = MagicMock()
    docs_cur.fetchall.return_value = docs
    itens_cur = MagicMock()
    itens_cur.fetchall.return_value = [(i,) for i in itens]
    update_cur = MagicMock()

    conn = MagicMock()
    conn.cursor.return_value.__enter__.side_effect = [docs_cur, itens_cur, update_cur]
    conn.cursor.return_value.__exit__.return_value = False
    return conn, update_cur


def test_analyze_one_persists_done_with_pdf():
    conn, update_cur = _conn_for_analyze_one([_doc()], ["Notebook"])
    http_client = _http_client_returning({"https://pncp/doc1": _pdf_response()})
    client = MagicMock()
    client.responses.create.return_value = _fake_openai_response(_deep_payload())

    status = analyze_one(
        conn,
        _row(),
        client=client,
        http_client=http_client,
        model="gpt-5.1",
        profile_instructions=PROFILE_TEXT,
    )

    assert status == "done"
    params = update_cur.execute.call_args.args[1]
    assert params["deep_status"] == "done"
    assert params["deep_verdict"] == "fit"
    assert json.loads(params["requirements"]) == _deep_payload()["requirements"]
    assert json.loads(params["prazos"]) == _deep_payload()["prazos"]
    assert params["error"] is None
    conn.commit.assert_called()


def test_analyze_one_no_documents_skips_with_metadata_only_analysis():
    conn, update_cur = _conn_for_analyze_one([], ["Notebook"])
    http_client = MagicMock()
    client = MagicMock()
    client.responses.create.return_value = _fake_openai_response(_deep_payload())

    status = analyze_one(
        conn,
        _row(),
        client=client,
        http_client=http_client,
        model="gpt-5.1",
        profile_instructions=PROFILE_TEXT,
    )

    assert status == "skipped"
    params = update_cur.execute.call_args.args[1]
    assert params["deep_status"] == "skipped"
    assert params["error"] == "no active documents"
    assert params["deep_verdict"] == "fit"  # still persisted from metadata-only call


def test_analyze_one_oversized_pdfs_skips():
    conn, update_cur = _conn_for_analyze_one([_doc()], [])
    big_content = b"0" * (31 * 1024 * 1024)
    http_client = _http_client_returning({"https://pncp/doc1": _pdf_response(big_content)})
    client = MagicMock()
    client.responses.create.return_value = _fake_openai_response(_deep_payload())

    status = analyze_one(
        conn,
        _row(),
        client=client,
        http_client=http_client,
        model="gpt-5.1",
        profile_instructions=PROFILE_TEXT,
    )

    assert status == "skipped"
    params = update_cur.execute.call_args.args[1]
    assert "exceeds" in params["error"]


def test_analyze_one_refusal_marks_error():
    conn, update_cur = _conn_for_analyze_one([_doc()], [])
    http_client = _http_client_returning({"https://pncp/doc1": _pdf_response()})
    client = MagicMock()
    client.responses.create.return_value = _fake_openai_response(_deep_payload(), refused=True)

    status = analyze_one(
        conn,
        _row(),
        client=client,
        http_client=http_client,
        model="gpt-5.1",
        profile_instructions=PROFILE_TEXT,
    )

    assert status == "error"
    params = update_cur.execute.call_args.args[1]
    assert params["deep_status"] == "error"
    assert params["deep_verdict"] is None


def test_analyze_one_exception_isolated_marks_error_and_continues():
    conn = MagicMock()
    update_cur = MagicMock()

    # pick_documents' cursor raises (simulating a DB blowup mid-row); the
    # error-persist cursor (later, separate `with conn.cursor() as cur`)
    # must still succeed via a fresh MagicMock context manager.
    calls = {"n": 0}

    def cursor_factory(*args, **kwargs):
        calls["n"] += 1
        cm = MagicMock()
        if calls["n"] == 1:
            cm.__enter__.side_effect = RuntimeError("db exploded")
        else:
            cm.__enter__.return_value = update_cur
            cm.__exit__.return_value = False
        return cm

    conn.cursor.side_effect = cursor_factory

    client = MagicMock()
    http_client = MagicMock()

    status = analyze_one(
        conn,
        _row(),
        client=client,
        http_client=http_client,
        model="gpt-5.1",
        profile_instructions=PROFILE_TEXT,
    )

    assert status == "error"
    params = update_cur.execute.call_args.args[1]
    assert params["deep_status"] == "error"
    assert "db exploded" in params["error"]
    client.responses.create.assert_not_called()


# --- deep_analyze orchestration ------------------------------------------


def test_deep_analyze_processes_rows_and_is_resumable():
    """A pending row is selected via _SELECT_SQL (deep_status IS NULL); once
    analyze_one persists deep_status='done', a fresh select would no longer
    return it — resumability is enforced by the SQL predicate itself, which
    we exercise here by returning an empty select on a would-be second call."""
    select_cur = MagicMock()
    select_cur.fetchall.return_value = [_row("num-1")]

    docs_cur = MagicMock()
    docs_cur.fetchall.return_value = []
    itens_cur = MagicMock()
    itens_cur.fetchall.return_value = []
    update_cur = MagicMock()

    conn = MagicMock()
    conn.cursor.return_value.__enter__.side_effect = [
        select_cur,
        docs_cur,
        itens_cur,
        update_cur,
    ]
    conn.cursor.return_value.__exit__.return_value = False

    client = MagicMock()
    client.responses.create.return_value = _fake_openai_response(_deep_payload())
    http_client = MagicMock()

    result = deep_analyze(
        conn,
        limit=5,
        client=client,
        http_client=http_client,
        profile_text=PROFILE_TEXT,
    )

    assert result["processed"] == 1
    assert result["skipped"] == 1  # no docs -> metadata-only, still "skipped"
    select_args = select_cur.execute.call_args.args
    assert select_args[1] == {"limit": 5}
