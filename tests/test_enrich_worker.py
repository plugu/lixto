"""Unit tests for src/lixto/enrich/worker.py.

Fully mocked psycopg connections/cursors, a mocked LlmClient and a mocked
httpx client — no network, no live database.
"""

import json
from unittest.mock import MagicMock

import pytest

from lixto.enrich import worker
from lixto.enrich.embed import build_embedding_text
from lixto.enrich.schema import validate_payload
from lixto.enrich.worker import (
    _SELECT_PENDING_SQL,
    CONTEXT_TEXT_CHARS,
    INSTRUCTIONS,
    MAX_ITEMS,
    build_prompt,
    enrich,
    enrich_one,
)


def _row(procurement_id=1):
    return {
        "id": procurement_id,
        "source_id": f"num-{procurement_id}",
        "description": "Aquisição de lápis grafite para escolas municipais",
        "additional_info": "Entrega parcelada",
        "modality_name": "Pregão Eletrônico",
        "state": "RJ",
        "city_name": "Rio de Janeiro",
        "estimated_value": 12345,
        "proposal_closes_at": "2026-09-01",
        "is_price_registry": True,
        "agency_name": "Prefeitura do Rio",
    }


def _item(description="Lápis preto nº 2", quantity=100):
    return {
        "description": description,
        "quantity": quantity,
        "unit": "UN",
        "estimated_unit_price": "1.50",
        "kind": "material",
    }


def _doc(seq=1, method="pypdf", text="texto do edital", pdf_bytes=None):
    return {
        "sequence": seq,
        "method": method,
        "pages": 10,
        "chars": len(text or ""),
        "text": text,
        "pdf_bytes": pdf_bytes,
    }


def _payload():
    """Raw model output (pre-validation), as the LLM would return it."""
    return {
        "summary": "Compra de lápis.",
        "categories": ["material escolar"],
        "concepts": ["lapis"],
        "keywords": ["lapis", "lapis preto"],
        "cnae_candidates": [{"code": "4761-0/03", "confidence": 0.8}],
        "requirements": [
            {"kind": "tax_compliance", "description": "CND federal"},
            {"kind": "technical_qualification", "description": "Atestado"},
        ],
        "requires_certification": False,
        "requires_technical_certificate": False,
        "me_epp_exclusive": True,
        "me_epp_preference": False,
        "delivery": {"location": "Rio de Janeiro", "deadline_days": 30},
        "risks": ["prazo curto"],
        "complexity": "low",
        "confidence": 0.7,
    }


def _llm(payload=None, model="cheap-model"):
    llm = MagicMock()
    llm.complete_json_text.return_value = (payload or _payload(), model)
    llm.complete_json_pdf.return_value = (payload or _payload(), "doc-model")
    llm.embed.side_effect = lambda texts: ([[0.5] * 4 for _ in texts], "embed-model")
    return llm


def _conn(items):
    """Cursor order inside enrich_one (with extract_for_procurement patched):
    fetch_items (select), then _persist (one cursor for the transaction)."""
    items_cur = MagicMock()
    items_cur.fetchall.return_value = items
    persist_cur = MagicMock()

    conn = MagicMock()
    conn.cursor.return_value.__enter__.side_effect = [items_cur, persist_cur]
    conn.cursor.return_value.__exit__.return_value = False
    return conn, persist_cur


def _enrichment_params(cur):
    """Params of the `procurement_enrichments` upsert (first statement)."""
    sql, params = cur.execute.call_args_list[0].args
    assert "INSERT INTO procurement_enrichments" in sql
    return params


def _params_for(cur, fragment):
    return [c.args[1] for c in cur.execute.call_args_list if fragment in c.args[0]]


# --- selection SQL -------------------------------------------------------


def test_select_sql_filters_open_unenriched_procurements():
    assert "FROM procurements p" in _SELECT_PENDING_SQL
    assert "(p.proposal_closes_at >= now() OR p.proposal_opens_at > now())" in _SELECT_PENDING_SQL
    assert "NOT EXISTS" in _SELECT_PENDING_SQL
    assert "FROM procurement_enrichments e" in _SELECT_PENDING_SQL
    assert "p.published_at >= now() - make_interval(days => %(days)s)" in _SELECT_PENDING_SQL
    assert "ORDER BY p.proposal_closes_at ASC NULLS LAST" in _SELECT_PENDING_SQL


def test_select_sql_has_no_portal_allowlist():
    assert "origin_system" not in _SELECT_PENDING_SQL
    assert not hasattr(worker, "PORTAIS_ATIVOS")


def test_retry_errors_predicate_reopens_error_rows():
    assert "NOT %(retry_errors)s OR e.status <> 'error'" in _SELECT_PENDING_SQL


def test_instructions_name_every_payload_field():
    for field in _payload():
        assert field in INSTRUCTIONS
    assert "48" in INSTRUCTIONS  # Lei 123 art. 48 I (ME/EPP exclusive)
    assert "0000-0/00" in INSTRUCTIONS
    for value in ("low", "medium", "high", "tax_compliance", "site_visit"):
        assert value in INSTRUCTIONS


# --- build_prompt --------------------------------------------------------


def test_build_prompt_includes_description_and_structured_fields():
    prompt = build_prompt(_row(), [], [])
    assert "Aquisição de lápis grafite" in prompt
    assert "Pregão Eletrônico" in prompt
    assert "RJ / Rio de Janeiro" in prompt
    assert "Prefeitura do Rio" in prompt
    assert "SRP" in prompt
    assert "## Texto do edital" not in prompt


def test_build_prompt_caps_items_at_max_items():
    items = [_item(f"Item {i}") for i in range(MAX_ITEMS + 10)]
    prompt = build_prompt(_row(), items, [])

    assert f"{MAX_ITEMS}. Item {MAX_ITEMS - 1}" in prompt
    assert f"{MAX_ITEMS + 1}." not in prompt
    assert "100 UN" in prompt
    assert "R$ 1.50" in prompt


def test_build_prompt_caps_edital_text():
    docs = [_doc(text="a" * (CONTEXT_TEXT_CHARS * 2))]
    prompt = build_prompt(_row(), [], docs)

    assert "## Texto do edital" in prompt
    edital = prompt.split("## Texto do edital\n", 1)[1]
    assert len(edital) == CONTEXT_TEXT_CHARS


def test_build_prompt_ignores_text_of_non_pypdf_docs():
    docs = [_doc(method="insufficient", text="restos de ocr")]
    prompt = build_prompt(_row(), [], docs)
    assert "restos de ocr" not in prompt


# --- routing -------------------------------------------------------------


@pytest.fixture
def patched(monkeypatch):
    """Patches the document layer so no DB/network is touched; the test sets
    `.docs` / `.urls` before calling enrich_one."""
    state = MagicMock()
    state.docs = []
    state.urls = []
    monkeypatch.setattr(worker, "extract_for_procurement", lambda *a, **k: state.docs)
    monkeypatch.setattr(worker, "pick_documents", lambda *a, **k: state.urls)
    return state


def test_pypdf_doc_routes_to_cheap_text_tier(patched):
    patched.docs = [_doc(method="pypdf")]
    conn, persist_cur = _conn([_item()])
    llm = _llm()

    status = enrich_one(conn, _row(), llm=llm, http_client=MagicMock())

    assert status == "done"
    llm.complete_json_pdf.assert_not_called()
    assert llm.complete_json_text.call_args.kwargs["tier"] == "cheap"
    params = _enrichment_params(persist_cur)
    assert params["input_kind"] == "text"
    assert params["status"] == "done"
    assert params["model"] == "cheap-model"
    assert params["keywords"] == ["lapis", "lapis preto"]
    conn.commit.assert_called()


def test_insufficient_docs_route_to_pdf_tier(patched):
    patched.docs = [_doc(method="insufficient", text="", pdf_bytes=b"%PDF-1.4")]
    conn, persist_cur = _conn([])
    llm = _llm()

    status = enrich_one(conn, _row(), llm=llm, http_client=MagicMock())

    assert status == "done"
    llm.complete_json_text.assert_not_called()
    assert llm.complete_json_pdf.call_count == 1
    params = _enrichment_params(persist_cur)
    assert params["input_kind"] == "pdf"
    assert params["model"] == "doc-model"


def test_insufficient_doc_without_cached_bytes_is_redownloaded(patched):
    patched.docs = [_doc(method="insufficient", text="", pdf_bytes=None)]
    patched.urls = [{"sequence": 1, "url": "https://pncp/doc1"}]
    conn, persist_cur = _conn([])
    resp = MagicMock()
    resp.content = b"%PDF-1.4 bytes"
    http_client = MagicMock()
    http_client.get.return_value = resp
    llm = _llm()

    status = enrich_one(conn, _row(), llm=llm, http_client=http_client)

    assert status == "done"
    http_client.get.assert_called_once()
    pdfs = llm.complete_json_pdf.call_args.kwargs["pdfs"]
    assert pdfs[0]["content"] == b"%PDF-1.4 bytes"
    assert _enrichment_params(persist_cur)["input_kind"] == "pdf"


def test_oversized_pdfs_fall_back_to_structured(patched):
    big = b"0" * (31 * 1024 * 1024)
    patched.docs = [_doc(method="insufficient", text="", pdf_bytes=big)]
    conn, persist_cur = _conn([])
    llm = _llm()

    status = enrich_one(conn, _row(), llm=llm, http_client=MagicMock())

    assert status == "done"
    llm.complete_json_pdf.assert_not_called()
    assert _enrichment_params(persist_cur)["input_kind"] == "structured"


def test_no_docs_routes_to_structured(patched):
    patched.docs = []
    conn, persist_cur = _conn([_item()])
    llm = _llm()

    status = enrich_one(conn, _row(), llm=llm, http_client=MagicMock())

    assert status == "done"
    assert llm.complete_json_text.call_args.kwargs["tier"] == "cheap"
    assert _enrichment_params(persist_cur)["input_kind"] == "structured"


# --- persistence: enrichment row + facet tables --------------------------


def test_enrichment_row_carries_the_validated_payload(patched):
    patched.docs = []
    conn, persist_cur = _conn([])

    enrich_one(conn, _row(7), llm=_llm(), http_client=MagicMock())

    params = _enrichment_params(persist_cur)
    assert params["procurement_id"] == 7
    assert params["schema_version"] == worker.SCHEMA_VERSION
    assert params["summary"] == "Compra de lápis."
    assert params["concepts"] == ["lapis"]
    assert params["risks"] == ["prazo curto"]
    assert params["complexity"] == "low"
    assert params["me_epp_exclusive"] is True
    assert params["delivery_location"] == "Rio de Janeiro"
    assert params["delivery_deadline_days"] == 30
    assert json.loads(params["data"]) == validate_payload(_payload())


def test_facet_tables_are_replaced_in_the_same_transaction(patched):
    patched.docs = []
    conn, persist_cur = _conn([])

    enrich_one(conn, _row(7), llm=_llm(), http_client=MagicMock())

    executed = [c.args[0] for c in persist_cur.execute.call_args_list]
    for table in (
        "procurement_categories",
        "procurement_requirements",
        "procurement_cnaes",
    ):
        assert any(sql.startswith("DELETE FROM " + table) for sql in executed)

    assert _params_for(persist_cur, "INSERT INTO procurement_categories") == [
        {"procurement_id": 7, "category": "material escolar"}
    ]
    assert _params_for(persist_cur, "INSERT INTO procurement_requirements") == [
        {
            "procurement_id": 7,
            "sequence": 1,
            "kind": "tax_compliance",
            "description": "CND federal",
        },
        {
            "procurement_id": 7,
            "sequence": 2,
            "kind": "technical_qualification",
            "description": "Atestado",
        },
    ]
    assert _params_for(persist_cur, "INSERT INTO procurement_cnaes") == [
        {"procurement_id": 7, "cnae_code": "4761003", "confidence": 0.8}
    ]
    # one commit for the whole persist step
    assert conn.commit.call_count == 1


def test_cnae_insert_marks_the_enrichment_origin(patched):
    patched.docs = []
    conn, persist_cur = _conn([])

    enrich_one(conn, _row(), llm=_llm(), http_client=MagicMock())

    sql = next(
        c.args[0]
        for c in persist_cur.execute.call_args_list
        if "INSERT INTO procurement_cnaes" in c.args[0]
    )
    assert "'enrichment'" in sql


# --- embedding -----------------------------------------------------------


def test_successful_row_embeds_canonical_text_into_the_same_transaction(patched):
    patched.docs = [_doc(method="pypdf")]
    conn, persist_cur = _conn([_item()])
    llm = _llm()

    status = enrich_one(conn, _row(7), llm=llm, http_client=MagicMock())

    assert status == "done"
    assert llm.embed.call_args.args[0] == [build_embedding_text(validate_payload(_payload()))]
    assert _params_for(persist_cur, "INSERT INTO procurement_embeddings") == [
        {"procurement_id": 7, "model": "embed-model", "embedding": "[0.5,0.5,0.5,0.5]"}
    ]


def test_embedding_sql_casts_to_vector():
    assert "%(embedding)s::vector" in worker._UPSERT_EMBEDDING_SQL
    assert "ON CONFLICT (procurement_id) DO UPDATE" in worker._UPSERT_EMBEDDING_SQL


def test_embed_failure_still_persists_the_enrichment(patched):
    patched.docs = [_doc(method="pypdf")]
    conn, persist_cur = _conn([_item()])
    llm = _llm()
    llm.embed.side_effect = RuntimeError("embeddings down")

    status = enrich_one(conn, _row(7), llm=llm, http_client=MagicMock())

    assert status == "done"
    params = _enrichment_params(persist_cur)
    assert params["status"] == "done"
    assert params["summary"] == "Compra de lápis."
    # no vector -> the stale row is dropped so `enrich embed` picks it up
    assert _params_for(persist_cur, "INSERT INTO procurement_embeddings") == []
    assert _params_for(persist_cur, "DELETE FROM procurement_embeddings") == [{"id": 7}]
    conn.commit.assert_called()


def test_error_row_carries_no_embedding(patched):
    conn, persist_cur = _conn([])
    llm = _llm(payload="not a dict")

    enrich_one(conn, _row(), llm=llm, http_client=MagicMock())

    llm.embed.assert_not_called()
    assert _params_for(persist_cur, "INSERT INTO procurement_embeddings") == []


# --- failure handling ----------------------------------------------------


def test_invalid_payload_persists_error_row(patched):
    conn, persist_cur = _conn([])
    llm = _llm(payload="not a dict")

    status = enrich_one(conn, _row(), llm=llm, http_client=MagicMock())

    assert status == "error"
    params = _enrichment_params(persist_cur)
    assert params["status"] == "error"
    assert params["error"] == "resposta inválida"
    assert params["data"] == "{}"
    conn.commit.assert_called()


def test_sdk_exception_persists_error_row(patched):
    conn, persist_cur = _conn([])
    llm = MagicMock()
    llm.complete_json_text.side_effect = RuntimeError("provider exploded")

    status = enrich_one(conn, _row(), llm=llm, http_client=MagicMock())

    assert status == "error"
    params = _enrichment_params(persist_cur)
    assert params["status"] == "error"
    assert "provider exploded" in params["error"]
    conn.rollback.assert_called()
    conn.commit.assert_called()


# --- enrich orchestration ------------------------------------------------


def _conn_for_enrich(rows):
    select_cur = MagicMock()
    select_cur.fetchall.return_value = rows

    cursors = [select_cur]
    persist_curs = []
    for _ in rows:
        items_cur = MagicMock()
        items_cur.fetchall.return_value = []
        persist_cur = MagicMock()
        persist_curs.append(persist_cur)
        cursors.extend([items_cur, persist_cur])

    conn = MagicMock()
    conn.cursor.return_value.__enter__.side_effect = cursors
    conn.cursor.return_value.__exit__.return_value = False
    return conn, select_cur, persist_curs


def test_enrich_passes_days_and_retry_errors_to_sql(patched):
    conn, select_cur, _ = _conn_for_enrich([])

    result = enrich(conn, limit=7, days=30, retry_errors=True, llm=_llm(), http_client=MagicMock())

    assert result == {"processed": 0, "done": 0, "error": 0}
    params = select_cur.execute.call_args.args[1]
    assert params["limit"] == 7
    assert params["days"] == 30
    assert params["retry_errors"] is True


def test_enrich_defaults_are_no_days_no_retry(patched):
    conn, select_cur, _ = _conn_for_enrich([])

    enrich(conn, llm=_llm(), http_client=MagicMock())

    params = select_cur.execute.call_args.args[1]
    assert params["days"] is None
    assert params["retry_errors"] is False
    assert params["limit"] == worker.BATCH_LIMIT_DEFAULT


def test_enrich_fills_the_run_counters(patched):
    from lixto.runs import RunCounters

    conn, _select_cur, _ = _conn_for_enrich([_row(1)])
    counters = RunCounters()

    enrich(conn, llm=_llm(), http_client=MagicMock(), counters=counters)

    assert counters.as_dict() == {"processed": 1, "done": 1, "error": 0}


def test_enrich_isolates_a_failing_row_and_continues(patched):
    conn, _select_cur, persist_curs = _conn_for_enrich([_row(1), _row(2)])
    llm = MagicMock()
    llm.complete_json_text.side_effect = [RuntimeError("boom"), (_payload(), "cheap-model")]
    llm.embed.side_effect = lambda texts: ([[0.5] * 4 for _ in texts], "embed-model")

    result = enrich(conn, llm=llm, http_client=MagicMock())

    assert result == {"processed": 2, "done": 1, "error": 1}
    assert _enrichment_params(persist_curs[0])["status"] == "error"
    assert _enrichment_params(persist_curs[1])["status"] == "done"
