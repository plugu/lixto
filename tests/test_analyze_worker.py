"""Unit tests for src/lixto/analyze/worker.py and src/lixto/cli/analyze.py.

Fully mocked psycopg connections/cursors, a mocked LlmClient and a mocked
httpx client — no network, no live database.
"""

from __future__ import annotations

import json
from unittest.mock import MagicMock

import pytest
from typer.testing import CliRunner

import lixto.cli.analyze as analyze_cli
from lixto.analyze import worker
from lixto.analyze.schema import SCHEMA_VERSION, validate_analysis
from lixto.analyze.worker import (
    _SELECT_PENDING_SQL,
    DOCUMENT_SET_HASH_SQL,
    analyze,
    analyze_one,
    derive_me_epp,
)
from lixto.cli import app
from lixto.enrich.embed import build_embedding_text
from lixto.fence import Fence
from lixto.runs import RunCounters

runner = CliRunner()


@pytest.fixture(autouse=True)
def _unlimited_cap(monkeypatch):
    """Most tests care about neither the daily cap nor the fence; keep both
    inert unless a test explicitly overrides them."""
    monkeypatch.setattr(worker, "_daily_cap", lambda: 0)
    monkeypatch.setattr(worker, "get_fence", lambda: Fence((), (), False))


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
        "published_at": "2026-08-01",
        "proposal_opens_at": "2026-08-05",
        "proposal_closes_at": "2026-09-01",
        "is_price_registry": True,
        "agency_name": "Prefeitura do Rio",
    }


def _item(description="Lápis preto nº 2"):
    return {
        "description": description,
        "quantity": 100,
        "unit": "UN",
        "estimated_unit_price": "1.50",
        "kind": "material",
    }


def _doc(seq=1, method="pypdf", pages=2, pdf_bytes=None, url="https://pncp/doc1"):
    page_texts = [f"página {i}" for i in range(pages)] if method in ("pypdf", "ocr") else None
    return {
        "sequence": seq,
        "method": method,
        "pages": pages,
        "chars": 100,
        "text": "\n\n".join(page_texts or []),
        "page_texts": page_texts,
        "title": "Edital 12/2026",
        "type_id": 2,
        "published_at": None,
        "url": url,
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
        "requires_certification": False,
        "requires_technical_certificate": False,
        "delivery": {"location": "Rio de Janeiro", "deadline_days": 30},
        "complexity": "low",
        "confidence": 0.7,
        "executive_summary": "Pregão para compra de lápis.",
        "object": "Aquisição de lápis grafite.",
        "overall_risk": "medium",
        "facts": [
            {
                "group": "basic",
                "key": "judgment_criteria",
                "label": "Critério de julgamento",
                "value": "Menor preço por item",
                "statement_kind": "fact",
                "confidence": "high",
                "citations": [{"sequence": 1, "page": 1}],
            }
        ],
        "dates": [
            {
                "kind": "proposal_deadline",
                "label": "Encerramento",
                "occurs_at": "2026-09-01T09:00:00",
                "raw_text": "até 09h de 01/09/2026",
                "confidence": "high",
                "citations": [{"sequence": 1, "page": 2}],
            }
        ],
        "requirements": [
            {
                "category": "fiscal_labor",
                "title": "CND federal",
                "description": "Certidão negativa de débitos federais.",
                "mandatory": True,
                "severity": "high",
                "statement_kind": "fact",
                "confidence": "high",
                "citations": [{"sequence": 1, "page": 2}],
            }
        ],
        "penalties": [
            {
                "description": "Multa por atraso",
                "basis": "0,5% ao dia",
                "confidence": "medium",
                "citations": [{"sequence": 1, "page": 2}],
            }
        ],
        "risks": [
            {
                "kind": "red_flag",
                "severity": "high",
                "title": "Prazo curto",
                "description": "Entrega em 5 dias.",
                "recommendation": "Confirmar logística.",
                "citations": [{"sequence": 1, "page": 1}],
            }
        ],
        "missing": [{"field": "prazo de garantia", "note": "não consta"}],
    }


def _validated(doc_pages=None):
    payload = validate_analysis(_payload(), doc_pages=doc_pages or {1: 2})
    assert payload is not None
    return payload


def _usage(calls=0, prompt_tokens=0, completion_tokens=0, est_usd_micros=0, unpriced_models=None):
    return {
        "calls": calls,
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "est_usd_micros": est_usd_micros,
        "unpriced_models": unpriced_models or [],
    }


def _llm(payload=None, model="doc-model", usage=None):
    llm = MagicMock()
    llm.complete_json_text.return_value = (payload or _payload(), model)
    llm.complete_json_pdf.return_value = (payload or _payload(), "pdf-model")
    llm.embed.side_effect = lambda texts: ([[0.5] * 4 for _ in texts], "embed-model")
    llm.usage_summary.return_value = usage or _usage()
    return llm


def _conn(items, benefit_ids=None, doc_hash="hash-abc"):
    """Cursor order inside analyze_one (with extract_for_procurement patched):
    document_set_hash, fetch_benefit_ids, fetch_items, then _persist (one
    cursor for the whole transaction)."""
    hash_cur = MagicMock()
    hash_cur.fetchone.return_value = (doc_hash,)
    benefits_cur = MagicMock()
    benefits_cur.fetchall.return_value = [(b,) for b in (benefit_ids or [])]
    items_cur = MagicMock()
    items_cur.fetchall.return_value = items
    persist_cur = MagicMock()

    conn = MagicMock()
    conn.cursor.return_value.__enter__.side_effect = [
        hash_cur,
        benefits_cur,
        items_cur,
        persist_cur,
    ]
    conn.cursor.return_value.__exit__.return_value = False
    return conn, persist_cur


def _params_for(cur, fragment):
    return [c.args[1] for c in cur.execute.call_args_list if fragment in c.args[0]]


def _enrichment_params(cur):
    """Params of the `procurement_enrichments` upsert (first statement)."""
    sql, params = cur.execute.call_args_list[0].args
    assert "INSERT INTO procurement_enrichments" in sql
    return params


def _analysis_params(cur):
    return _params_for(cur, "INSERT INTO tender_analyses")[0]


@pytest.fixture
def patched(monkeypatch):
    """Patches the document layer so no DB/network is touched; the test sets
    `.docs` before calling analyze_one."""
    state = MagicMock()
    state.docs = []
    monkeypatch.setattr(worker, "extract_for_procurement", lambda *a, **k: state.docs)
    return state


# --- selection SQL -------------------------------------------------------


def test_select_sql_filters_open_unanalyzed_procurements():
    assert "FROM procurements p" in _SELECT_PENDING_SQL
    assert "(p.proposal_closes_at >= now() OR p.proposal_opens_at > now())" in _SELECT_PENDING_SQL
    assert "NOT EXISTS" in _SELECT_PENDING_SQL
    assert "FROM tender_analyses t" in _SELECT_PENDING_SQL
    assert "procurement_enrichments" not in _SELECT_PENDING_SQL
    assert "p.published_at >= now() - make_interval(days => %(days)s)" in _SELECT_PENDING_SQL
    assert "ORDER BY p.proposal_closes_at ASC NULLS LAST" in _SELECT_PENDING_SQL


def test_select_sql_carries_the_prompt_fields():
    for column in ("p.source_id", "p.published_at", "p.proposal_opens_at", "p.estimated_value"):
        assert column in _SELECT_PENDING_SQL


def test_retry_errors_predicate_reopens_error_rows():
    assert "NOT %(retry_errors)s OR t.status <> 'error'" in _SELECT_PENDING_SQL


def test_used_today_counts_analyses():
    assert "FROM tender_analyses" in worker._USED_TODAY_SQL
    assert "analyzed_at >= date_trunc('day', now())" in worker._USED_TODAY_SQL


def test_document_set_hash_sql_is_the_shared_definition():
    """Ticket 134 copies this text verbatim into the web read side."""
    assert "md5(coalesce(string_agg(" in DOCUMENT_SET_HASH_SQL
    assert "to_char(published_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS')" in (
        DOCUMENT_SET_HASH_SQL
    )
    assert "ORDER BY sequence" in DOCUMENT_SET_HASH_SQL
    assert "FROM procurement_documents" in DOCUMENT_SET_HASH_SQL
    assert "is_active IS TRUE" in DOCUMENT_SET_HASH_SQL


# --- routing -------------------------------------------------------------


def test_documents_with_page_text_route_to_the_doc_tier(patched):
    patched.docs = [_doc(method="pypdf")]
    conn, persist_cur = _conn([_item()])
    llm = _llm()

    status = analyze_one(conn, _row(), llm=llm, http_client=MagicMock())

    assert status == "done"
    llm.complete_json_pdf.assert_not_called()
    kwargs = llm.complete_json_text.call_args.kwargs
    assert kwargs["tier"] == "doc"
    assert kwargs["name"] == "tender_analysis"
    assert kwargs["schema"] is worker.ANALYSIS_SCHEMA
    params = _enrichment_params(persist_cur)
    assert params["input_kind"] == "text"
    assert params["status"] == "done"
    assert params["model"] == "doc-model"
    conn.commit.assert_called()


def test_ocr_documents_also_route_to_text(patched):
    patched.docs = [_doc(method="ocr")]
    conn, persist_cur = _conn([_item()])

    analyze_one(conn, _row(), llm=_llm(), http_client=MagicMock())

    assert _enrichment_params(persist_cur)["input_kind"] == "text"


def test_insufficient_docs_route_to_the_pdf_tier(patched):
    patched.docs = [_doc(method="insufficient", pdf_bytes=b"%PDF-1.4")]
    conn, persist_cur = _conn([])
    llm = _llm()

    status = analyze_one(conn, _row(), llm=llm, http_client=MagicMock())

    assert status == "done"
    llm.complete_json_text.assert_not_called()
    assert llm.complete_json_pdf.call_args.kwargs["name"] == "tender_analysis"
    assert _enrichment_params(persist_cur)["input_kind"] == "pdf"
    assert _enrichment_params(persist_cur)["model"] == "pdf-model"


def test_insufficient_doc_without_cached_bytes_is_redownloaded(patched):
    patched.docs = [_doc(method="insufficient", pdf_bytes=None)]
    conn, persist_cur = _conn([])
    resp = MagicMock()
    resp.content = b"%PDF-1.4 bytes"
    http_client = MagicMock()
    http_client.get.return_value = resp
    llm = _llm()

    analyze_one(conn, _row(), llm=llm, http_client=http_client)

    http_client.get.assert_called_once()
    assert llm.complete_json_pdf.call_args.kwargs["pdfs"][0]["content"] == b"%PDF-1.4 bytes"
    assert _enrichment_params(persist_cur)["input_kind"] == "pdf"


def test_more_than_two_insufficient_docs_fall_back_to_structured(patched):
    patched.docs = [_doc(seq=i, method="insufficient", pdf_bytes=b"%PDF") for i in range(3)]
    conn, persist_cur = _conn([])
    llm = _llm()

    analyze_one(conn, _row(), llm=llm, http_client=MagicMock())

    llm.complete_json_pdf.assert_not_called()
    assert llm.complete_json_text.call_args.kwargs["tier"] == "cheap"
    assert _enrichment_params(persist_cur)["input_kind"] == "structured"


def test_oversized_pdfs_fall_back_to_structured(patched):
    big = b"0" * (31 * 1024 * 1024)
    patched.docs = [_doc(method="insufficient", pdf_bytes=big)]
    conn, persist_cur = _conn([])
    llm = _llm()

    analyze_one(conn, _row(), llm=llm, http_client=MagicMock())

    llm.complete_json_pdf.assert_not_called()
    assert _enrichment_params(persist_cur)["input_kind"] == "structured"


def test_no_documents_routes_to_the_cheap_structured_tier(patched):
    patched.docs = []
    conn, persist_cur = _conn([_item()])
    llm = _llm()

    analyze_one(conn, _row(), llm=llm, http_client=MagicMock())

    assert llm.complete_json_text.call_args.kwargs["tier"] == "cheap"
    assert _enrichment_params(persist_cur)["input_kind"] == "structured"


def test_max_chars_comes_from_the_environment(monkeypatch, patched):
    monkeypatch.setenv("LIXTO_ANALYZE_MAX_CHARS", "120")
    patched.docs = [_doc(method="pypdf", pages=8)]
    conn, persist_cur = _conn([])

    analyze_one(conn, _row(), llm=_llm(), http_client=MagicMock())

    assert _analysis_params(persist_cur)["input_truncated"] is True


def test_citations_are_validated_against_the_documents_actually_sent(patched):
    """The model cites page 9 of a two-page document: the citation is dropped
    and the uncited fact is demoted."""
    patched.docs = [_doc(method="pypdf", pages=2)]
    conn, persist_cur = _conn([])
    payload = _payload()
    payload["facts"][0]["citations"] = [{"sequence": 1, "page": 9}]

    analyze_one(conn, _row(), llm=_llm(payload=payload), http_client=MagicMock())

    fact = _params_for(persist_cur, "INSERT INTO tender_analysis_facts")[0]
    assert fact["citations"] == "[]"
    assert fact["statement_kind"] == "inference"
    assert fact["confidence"] == "low"


# --- persistence ---------------------------------------------------------


def test_enrichment_row_carries_the_derived_facets(patched):
    patched.docs = [_doc(method="pypdf")]
    conn, persist_cur = _conn([], benefit_ids=[1, 1])

    analyze_one(conn, _row(7), llm=_llm(), http_client=MagicMock())

    params = _enrichment_params(persist_cur)
    assert params["procurement_id"] == 7
    assert params["schema_version"] == SCHEMA_VERSION == "2.0"
    assert params["summary"] == "Compra de lápis."
    assert params["concepts"] == ["lapis"]
    assert params["complexity"] == "low"
    # facet risks = the dossier risk titles
    assert params["risks"] == ["Prazo curto"]
    # me_epp is derived from procurement_items.benefit_type_id, not payload.
    assert params["me_epp_exclusive"] is True
    assert params["me_epp_preference"] is False
    assert params["delivery_location"] == "Rio de Janeiro"
    assert params["delivery_deadline_days"] == 30
    data = json.loads(params["data"])
    assert data == json.loads(worker.to_json(_validated()))
    # the parsed instant is stored as ISO-8601 in JSONB
    assert data["dates"][0]["occurs_at"] == "2026-09-01T09:00:00-03:00"


def test_facet_tables_are_replaced_from_the_dossier(patched):
    patched.docs = [_doc(method="pypdf")]
    conn, persist_cur = _conn([])

    analyze_one(conn, _row(7), llm=_llm(), http_client=MagicMock())

    executed = [c.args[0] for c in persist_cur.execute.call_args_list]
    for table in ("procurement_categories", "procurement_requirements", "procurement_cnaes"):
        assert any(sql.startswith("DELETE FROM " + table) for sql in executed)

    assert _params_for(persist_cur, "INSERT INTO procurement_categories") == [
        {"procurement_id": 7, "category": "material escolar"}
    ]
    assert _params_for(persist_cur, "INSERT INTO procurement_requirements") == [
        {
            "procurement_id": 7,
            "sequence": 1,
            "kind": "tax_compliance",
            "description": "CND federal: Certidão negativa de débitos federais.",
        }
    ]
    assert _params_for(persist_cur, "INSERT INTO procurement_cnaes") == [
        {"procurement_id": 7, "cnae_code": "4761003", "confidence": 0.8}
    ]


def test_enrichment_and_dossier_land_in_one_commit(patched):
    patched.docs = [_doc(method="pypdf")]
    conn, persist_cur = _conn([])

    analyze_one(conn, _row(7), llm=_llm(), http_client=MagicMock())

    executed = [c.args[0] for c in persist_cur.execute.call_args_list]
    enrichment_at = next(i for i, s in enumerate(executed) if "procurement_enrichments" in s)
    analysis_at = next(i for i, s in enumerate(executed) if "INSERT INTO tender_analyses" in s)
    facts_at = next(i for i, s in enumerate(executed) if "INSERT INTO tender_analysis_facts" in s)
    # facets, then the analysis parent, then its children — one transaction.
    assert enrichment_at < analysis_at < facts_at
    assert conn.commit.call_count == 1


def test_analysis_row_carries_the_dossier_header(patched):
    patched.docs = [_doc(method="pypdf")]
    conn, persist_cur = _conn([], doc_hash="hash-xyz")

    analyze_one(conn, _row(7), llm=_llm(), http_client=MagicMock())

    params = _analysis_params(persist_cur)
    assert params["procurement_id"] == 7
    assert params["status"] == "done"
    assert params["schema_version"] == "2.0"
    assert params["document_set_hash"] == "hash-xyz"
    assert params["input_kind"] == "text"
    assert params["input_chars"] > 0
    assert params["input_truncated"] is False
    assert params["executive_summary"] == "Pregão para compra de lápis."
    assert params["object_text"] == "Aquisição de lápis grafite."
    assert params["overall_risk"] == "medium"


def test_analysis_upsert_bumps_the_version_on_conflict():
    assert "ON CONFLICT (procurement_id) DO UPDATE" in worker._UPSERT_ANALYSIS_SQL
    assert "version = tender_analyses.version + 1" in worker._UPSERT_ANALYSIS_SQL
    assert "analyzed_at = now()" in worker._UPSERT_ANALYSIS_SQL


def test_dossier_children_are_deleted_then_reinserted_with_sequences(patched):
    patched.docs = [_doc(method="pypdf")]
    conn, persist_cur = _conn([])

    analyze_one(conn, _row(7), llm=_llm(), http_client=MagicMock())

    executed = [c.args[0] for c in persist_cur.execute.call_args_list]
    for table in (
        "tender_analysis_facts",
        "tender_analysis_dates",
        "tender_analysis_requirements",
        "tender_analysis_penalties",
        "tender_analysis_risks",
        "tender_analysis_missing",
    ):
        assert any(sql.startswith("DELETE FROM " + table) for sql in executed)
        assert any(f"INSERT INTO {table}" in sql for sql in executed)

    fact = _params_for(persist_cur, "INSERT INTO tender_analysis_facts")[0]
    assert fact == {
        "procurement_id": 7,
        "group": "basic",
        "key": "judgment_criteria",
        "label": "Critério de julgamento",
        "value": "Menor preço por item",
        "statement_kind": "fact",
        "confidence": "high",
        "citations": '[{"sequence": 1, "page": 1}]',
    }

    date = _params_for(persist_cur, "INSERT INTO tender_analysis_dates")[0]
    assert date["sequence"] == 1
    assert date["kind"] == "proposal_deadline"
    assert date["occurs_at"].isoformat() == "2026-09-01T09:00:00-03:00"

    requirement = _params_for(persist_cur, "INSERT INTO tender_analysis_requirements")[0]
    assert requirement["sequence"] == 1
    assert requirement["category"] == "fiscal_labor"
    assert requirement["mandatory"] is True

    penalty = _params_for(persist_cur, "INSERT INTO tender_analysis_penalties")[0]
    assert penalty["basis"] == "0,5% ao dia"

    risk = _params_for(persist_cur, "INSERT INTO tender_analysis_risks")[0]
    assert risk["kind"] == "red_flag"
    assert risk["recommendation"] == "Confirmar logística."

    assert _params_for(persist_cur, "INSERT INTO tender_analysis_missing") == [
        {"procurement_id": 7, "sequence": 1, "field": "prazo de garantia", "note": "não consta"}
    ]


def test_facts_insert_quotes_the_group_column():
    """`group` is a reserved word in SQL."""
    assert '"group"' in worker._INSERT_FACT_SQL


# --- embedding -----------------------------------------------------------


def test_successful_row_embeds_canonical_text_into_the_same_transaction(patched):
    patched.docs = [_doc(method="pypdf")]
    conn, persist_cur = _conn([_item()])
    llm = _llm()

    analyze_one(conn, _row(7), llm=llm, http_client=MagicMock())

    assert llm.embed.call_args.args[0] == [build_embedding_text(_validated())]
    assert _params_for(persist_cur, "INSERT INTO procurement_embeddings") == [
        {"procurement_id": 7, "model": "embed-model", "embedding": "[0.5,0.5,0.5,0.5]"}
    ]


def test_embed_failure_still_persists_the_analysis(patched):
    patched.docs = [_doc(method="pypdf")]
    conn, persist_cur = _conn([_item()])
    llm = _llm()
    llm.embed.side_effect = RuntimeError("embeddings down")

    status = analyze_one(conn, _row(7), llm=llm, http_client=MagicMock())

    assert status == "done"
    assert _params_for(persist_cur, "INSERT INTO procurement_embeddings") == []
    assert _params_for(persist_cur, "DELETE FROM procurement_embeddings") == [{"id": 7}]


# --- failure handling ----------------------------------------------------


def test_invalid_payload_persists_error_rows(patched):
    patched.docs = [_doc(method="pypdf")]
    conn, persist_cur = _conn([])

    status = analyze_one(conn, _row(), llm=_llm(payload="não é um objeto"), http_client=MagicMock())

    assert status == "error"
    enrichment = _enrichment_params(persist_cur)
    assert enrichment["status"] == "error"
    assert enrichment["error"] == "resposta inválida"
    assert enrichment["data"] == "{}"
    analysis = _analysis_params(persist_cur)
    assert analysis["status"] == "error"
    assert analysis["error"] == "resposta inválida"
    assert analysis["data"] == "{}"
    assert analysis["executive_summary"] is None
    assert analysis["overall_risk"] is None
    conn.commit.assert_called()


def test_sdk_exception_rolls_back_then_persists_an_error_row(patched):
    patched.docs = []
    conn, persist_cur = _conn([])
    llm = MagicMock()
    llm.complete_json_text.side_effect = RuntimeError("provider exploded")

    status = analyze_one(conn, _row(), llm=llm, http_client=MagicMock())

    assert status == "error"
    assert "provider exploded" in _analysis_params(persist_cur)["error"]
    conn.rollback.assert_called()
    conn.commit.assert_called()


def test_error_row_carries_no_embedding_and_no_children(patched):
    patched.docs = []
    conn, persist_cur = _conn([])

    analyze_one(conn, _row(), llm=_llm(payload="não é um objeto"), http_client=MagicMock())

    assert _params_for(persist_cur, "INSERT INTO procurement_embeddings") == []
    assert _params_for(persist_cur, "INSERT INTO tender_analysis_facts") == []
    assert _params_for(persist_cur, "DELETE FROM tender_analysis_facts") == [{"id": 1}]


# --- Tier-0 ME/EPP -------------------------------------------------------


@pytest.mark.parametrize(
    "benefit_ids, expected",
    [
        ([1, 1, 1], (True, False)),
        ([1, 4], (False, True)),
        ([3, 4], (False, True)),
        ([4, 5], (False, False)),
        ([], (None, None)),
        ([None, None], (None, None)),
    ],
)
def test_derive_me_epp_truth_table(benefit_ids, expected):
    assert derive_me_epp(benefit_ids) == expected


# --- analyze orchestration ----------------------------------------------


def _conn_for_analyze(rows):
    select_cur = MagicMock()
    select_cur.fetchall.return_value = rows

    cursors = [select_cur]
    persist_curs = []
    for _ in rows:
        hash_cur = MagicMock()
        hash_cur.fetchone.return_value = ("hash",)
        benefits_cur = MagicMock()
        benefits_cur.fetchall.return_value = []
        items_cur = MagicMock()
        items_cur.fetchall.return_value = []
        persist_cur = MagicMock()
        persist_curs.append(persist_cur)
        cursors.extend([hash_cur, benefits_cur, items_cur, persist_cur])

    conn = MagicMock()
    conn.cursor.return_value.__enter__.side_effect = cursors
    conn.cursor.return_value.__exit__.return_value = False
    return conn, select_cur, persist_curs


def test_analyze_passes_days_and_retry_errors_to_sql(patched):
    conn, select_cur, _ = _conn_for_analyze([])

    result = analyze(conn, limit=7, days=30, retry_errors=True, llm=_llm(), http_client=MagicMock())

    assert result["processed"] == 0
    assert result["cap_reached"] == 0
    params = select_cur.execute.call_args.args[1]
    assert params == {"limit": 7, "days": 30, "retry_errors": True}


def test_analyze_defaults_are_no_days_no_retry(patched):
    conn, select_cur, _ = _conn_for_analyze([])

    analyze(conn, llm=_llm(), http_client=MagicMock())

    params = select_cur.execute.call_args.args[1]
    assert params["days"] is None
    assert params["retry_errors"] is False
    assert params["limit"] == worker.BATCH_LIMIT_DEFAULT


def test_analyze_fills_the_run_counters(patched):
    conn, _select_cur, _ = _conn_for_analyze([_row(1)])
    counters = RunCounters()

    analyze(conn, llm=_llm(), http_client=MagicMock(), counters=counters)

    result = counters.as_dict()
    assert result["processed"] == 1
    assert result["done"] == 1
    assert result["error"] == 0


def test_analyze_isolates_a_failing_row_and_continues(patched):
    conn, _select_cur, persist_curs = _conn_for_analyze([_row(1), _row(2)])
    llm = MagicMock()
    llm.complete_json_text.side_effect = [RuntimeError("boom"), (_payload(), "doc-model")]
    llm.embed.side_effect = lambda texts: ([[0.5] * 4 for _ in texts], "embed-model")
    llm.usage_summary.return_value = _usage()

    result = analyze(conn, llm=llm, http_client=MagicMock())

    assert result["processed"] == 2
    assert result["done"] == 1
    assert result["error"] == 1
    assert _analysis_params(persist_curs[0])["status"] == "error"
    assert _analysis_params(persist_curs[1])["status"] == "done"


def test_analyze_reports_llm_usage(patched):
    conn, _select_cur, _ = _conn_for_analyze([])
    llm = _llm(
        usage=_usage(calls=3, prompt_tokens=1000, completion_tokens=200, est_usd_micros=4500)
    )

    result = analyze(conn, llm=llm, http_client=MagicMock())

    assert result["llm_calls"] == 3
    assert result["llm_prompt_tokens"] == 1000
    assert result["est_usd"] == pytest.approx(0.0045)


# --- fence ---------------------------------------------------------------


def test_pending_sql_is_unchanged_for_an_inactive_fence():
    assert worker._pending_sql(Fence((), (), False)) == _SELECT_PENDING_SQL


def test_pending_sql_splices_the_fence_before_order_by():
    fence = Fence(portals=("compras.gov.br",), modalities=(6, 8), open_only=True)

    sql = worker._pending_sql(fence)

    assert "p.origin_system = ANY(%(fence_portals)s)" in sql
    assert sql.index("fence_portals") < sql.index("ORDER BY")


def test_analyze_merges_fence_params_into_the_select(patched):
    conn, select_cur, _ = _conn_for_analyze([])
    fence = Fence(portals=("compras.gov.br",), modalities=(6,), open_only=True)

    analyze(conn, llm=_llm(), http_client=MagicMock(), fence=fence)

    sql, params = select_cur.execute.call_args.args
    assert "fence_portals" in sql
    assert params["fence_portals"] == ["compras.gov.br"]
    assert params["fence_modalities"] == [6]


# --- daily cap -----------------------------------------------------------


def test_cap_reached_skips_the_select_entirely(monkeypatch, patched):
    monkeypatch.setattr(worker, "_daily_cap", lambda: 1500)
    used_cur = MagicMock()
    used_cur.fetchone.return_value = (1500,)
    conn = MagicMock()
    conn.cursor.return_value.__enter__.side_effect = [used_cur]
    conn.cursor.return_value.__exit__.return_value = False

    result = analyze(conn, llm=_llm(), http_client=MagicMock())

    assert result["cap"] == 1500
    assert result["used_today_at_start"] == 1500
    assert result["cap_reached"] == 1
    assert result["processed"] == 0
    used_cur.execute.assert_called_once_with(worker._USED_TODAY_SQL)
    assert conn.cursor.call_count == 1


def test_effective_limit_is_cap_minus_used(monkeypatch, patched):
    monkeypatch.setattr(worker, "_daily_cap", lambda: 10)
    used_cur = MagicMock()
    used_cur.fetchone.return_value = (7,)
    select_cur = MagicMock()
    select_cur.fetchall.return_value = []
    conn = MagicMock()
    conn.cursor.return_value.__enter__.side_effect = [used_cur, select_cur]
    conn.cursor.return_value.__exit__.return_value = False

    result = analyze(conn, limit=50, llm=_llm(), http_client=MagicMock())

    assert select_cur.execute.call_args.args[1]["limit"] == 3
    assert result["cap_reached"] == 0


def test_cap_reached_when_the_selected_rows_hit_the_effective_limit(monkeypatch, patched):
    monkeypatch.setattr(worker, "_daily_cap", lambda: 10)
    used_cur = MagicMock()
    used_cur.fetchone.return_value = (9,)  # remaining = 1
    select_cur = MagicMock()
    select_cur.fetchall.return_value = [_row(1)]
    hash_cur = MagicMock()
    hash_cur.fetchone.return_value = ("hash",)
    benefits_cur = MagicMock()
    benefits_cur.fetchall.return_value = []
    items_cur = MagicMock()
    items_cur.fetchall.return_value = []
    conn = MagicMock()
    conn.cursor.return_value.__enter__.side_effect = [
        used_cur,
        select_cur,
        hash_cur,
        benefits_cur,
        items_cur,
        MagicMock(),
    ]
    conn.cursor.return_value.__exit__.return_value = False

    result = analyze(conn, llm=_llm(), http_client=MagicMock())

    assert result["processed"] == 1
    assert result["cap_reached"] == 1


def test_unlimited_cap_never_queries_used_today(patched):
    conn, _select_cur, _ = _conn_for_analyze([])

    result = analyze(conn, llm=_llm(), http_client=MagicMock())

    assert result["cap"] == 0
    assert conn.cursor.call_count == 1


# --- CLI -----------------------------------------------------------------


@pytest.fixture
def cli(monkeypatch):
    """Stubs the DB connection, the run log and the worker so the CLI test
    only exercises option parsing, output and the exit code."""
    calls: dict = {}
    conn = MagicMock()
    monkeypatch.setattr(analyze_cli.db, "get_connection", lambda: conn)

    result = {
        "processed": 3,
        "done": 2,
        "error": 1,
        "llm_calls": 4,
        "llm_prompt_tokens": 1000,
        "llm_completion_tokens": 200,
        "est_usd": 0.0045,
        "cap": 0,
        "cap_reached": 0,
    }
    calls["result"] = result

    def _run_analyze(_conn, **kwargs):
        calls["kwargs"] = kwargs
        return calls["result"]

    monkeypatch.setattr(analyze_cli, "run_analyze", _run_analyze)
    return calls


def test_cli_reports_counts_and_usage(cli):
    result = runner.invoke(app, ["analyze", "run", "--limit", "5", "--days", "7"])

    assert result.exit_code == 0
    assert "analyzed: 3 (done 2, error 1)" in result.stdout
    assert "usage: 4 calls, 1000 prompt + 200 completion tokens, est US$ 0.0045" in result.stdout
    assert cli["kwargs"]["limit"] == 5
    assert cli["kwargs"]["days"] == 7
    assert cli["kwargs"]["retry_errors"] is False


def test_cli_passes_retry_errors(cli):
    result = runner.invoke(app, ["analyze", "run", "--retry-errors"])

    assert result.exit_code == 0
    assert cli["kwargs"]["retry_errors"] is True


def test_cli_reports_the_daily_cap(cli):
    cli["result"] = {**cli["result"], "cap": 1500, "cap_reached": 1}

    result = runner.invoke(app, ["analyze", "run"])

    assert "daily cap reached (cap 1500)" in result.stdout


def test_cli_exits_1_when_every_row_failed(cli):
    cli["result"] = {**cli["result"], "processed": 2, "done": 0, "error": 2}

    result = runner.invoke(app, ["analyze", "run"])

    assert result.exit_code == 1


def test_enrich_group_no_longer_exposes_run():
    result = runner.invoke(app, ["enrich", "--help"])

    assert result.exit_code == 0
    assert "embed" in result.stdout
    assert " run" not in result.stdout
