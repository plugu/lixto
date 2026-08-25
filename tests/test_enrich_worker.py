"""Unit tests for src/plic/enrich/worker.py.

Fully mocked psycopg connections/cursors, a mocked LlmClient and a mocked
httpx client — no network, no live database (mirrors tests/test_agents_deep.py).
"""

from unittest.mock import MagicMock

import pytest

from plic.enrich import worker
from plic.enrich.embed import build_embedding_text
from plic.enrich.worker import (
    _SELECT_PENDING_SQL,
    CONTEXT_TEXT_CHARS,
    INSTRUCTIONS,
    MAX_ITENS,
    build_prompt,
    enrich,
    enrich_one,
)


def _row(numero="num-1"):
    return {
        "numero_controle_pncp": numero,
        "objeto_compra": "Aquisição de lápis grafite para escolas municipais",
        "informacao_complementar": "Entrega parcelada",
        "modalidade_nome": "Pregão Eletrônico",
        "uf": "RJ",
        "municipio_nome": "Rio de Janeiro",
        "valor_total_estimado": 12345,
        "data_encerramento_proposta": "2026-09-01",
        "srp": True,
        "orgao_razao_social": "Prefeitura do Rio",
    }


def _item(descricao="Lápis preto nº 2", quantidade=100):
    return {
        "descricao": descricao,
        "quantidade": quantidade,
        "unidade_medida": "UN",
        "valor_unitario_estimado": "1.50",
        "material_ou_servico": "M",
    }


def _doc(seq=1, metodo="pypdf", texto="texto do edital", pdf_bytes=None):
    return {
        "sequencial_documento": seq,
        "metodo": metodo,
        "paginas": 10,
        "chars": len(texto or ""),
        "texto": texto,
        "pdf_bytes": pdf_bytes,
    }


def _payload():
    return {
        "resumo": "Compra de lápis.",
        "categorias": ["material escolar"],
        "conceitos": ["lapis"],
        "palavras_chave": ["lapis", "lapis preto"],
        "cnae_candidatos": [{"codigo": "4761-0/03", "confianca": 0.8}],
        "requisitos": [{"tipo": "regularidade_fiscal", "descricao": "CND federal"}],
        "exige_certificacao": False,
        "exige_atestado_tecnico": False,
        "me_epp_exclusivo": True,
        "me_epp_preferencia": False,
        "entrega": {"local": "Rio de Janeiro", "prazo_dias": 30},
        "riscos": ["prazo curto"],
        "complexidade": "baixa",
        "confianca": 0.7,
    }


def _llm(payload=None, model="cheap-model"):
    llm = MagicMock()
    llm.complete_json_text.return_value = (payload or _payload(), model)
    llm.complete_json_pdf.return_value = (payload or _payload(), "doc-model")
    llm.embed.side_effect = lambda texts: ([[0.5] * 4 for _ in texts], "embed-model")
    return llm


def _conn(itens):
    """Cursor order inside enrich_one (with extract_for_licitacao patched):
    fetch_itens (select), then _upsert (insert + commit)."""
    itens_cur = MagicMock()
    itens_cur.fetchall.return_value = itens
    upsert_cur = MagicMock()

    conn = MagicMock()
    conn.cursor.return_value.__enter__.side_effect = [itens_cur, upsert_cur]
    conn.cursor.return_value.__exit__.return_value = False
    return conn, upsert_cur


@pytest.fixture
def patched(monkeypatch):
    """Patches the document layer so no DB/network is touched; the test sets
    `.docs` / `.urls` before calling enrich_one."""
    state = MagicMock()
    state.docs = []
    state.urls = []
    monkeypatch.setattr(worker, "extract_for_licitacao", lambda *a, **k: state.docs)
    monkeypatch.setattr(worker, "pick_documents", lambda *a, **k: state.urls)
    return state


# --- selection SQL -------------------------------------------------------


def test_select_sql_filters_open_unenriched_licitacoes():
    assert "l.usuario_nome = ANY(%(portais)s)" in _SELECT_PENDING_SQL
    assert (
        "(l.data_encerramento_proposta >= now() OR l.data_abertura_proposta > now())"
        in _SELECT_PENDING_SQL
    )
    assert "NOT EXISTS" in _SELECT_PENDING_SQL
    assert "FROM enriquecimento e" in _SELECT_PENDING_SQL
    assert (
        "l.data_publicacao_pncp >= now() - make_interval(days => %(days)s)" in _SELECT_PENDING_SQL
    )
    assert "ORDER BY l.data_encerramento_proposta ASC NULLS LAST" in _SELECT_PENDING_SQL


def test_retry_errors_predicate_reopens_error_rows():
    assert "NOT %(retry_errors)s OR e.status <> 'error'" in _SELECT_PENDING_SQL


def test_instructions_name_every_payload_field():
    for field in _payload():
        assert field in INSTRUCTIONS
    assert "48" in INSTRUCTIONS  # Lei 123 art. 48 I (ME/EPP exclusivo)
    assert "0000-0/00" in INSTRUCTIONS


# --- build_prompt --------------------------------------------------------


def test_build_prompt_includes_objeto_and_structured_fields():
    prompt = build_prompt(_row(), [], [])
    assert "Aquisição de lápis grafite" in prompt
    assert "Pregão Eletrônico" in prompt
    assert "RJ / Rio de Janeiro" in prompt
    assert "SRP" in prompt
    assert "## Texto do edital" not in prompt


def test_build_prompt_caps_itens_at_max_itens():
    itens = [_item(f"Item {i}") for i in range(MAX_ITENS + 10)]
    prompt = build_prompt(_row(), itens, [])

    assert f"{MAX_ITENS}. Item {MAX_ITENS - 1}" in prompt
    assert f"{MAX_ITENS + 1}." not in prompt
    assert "100 UN" in prompt
    assert "R$ 1.50" in prompt


def test_build_prompt_caps_edital_text():
    docs = [_doc(texto="a" * (CONTEXT_TEXT_CHARS * 2))]
    prompt = build_prompt(_row(), [], docs)

    assert "## Texto do edital" in prompt
    edital = prompt.split("## Texto do edital\n", 1)[1]
    assert len(edital) == CONTEXT_TEXT_CHARS


def test_build_prompt_ignores_text_of_non_pypdf_docs():
    docs = [_doc(metodo="insuficiente", texto="restos de ocr")]
    prompt = build_prompt(_row(), [], docs)
    assert "restos de ocr" not in prompt


# --- routing -------------------------------------------------------------


def test_pypdf_doc_routes_to_cheap_text_tier(patched):
    patched.docs = [_doc(metodo="pypdf")]
    conn, upsert_cur = _conn([_item()])
    llm = _llm()

    status = enrich_one(conn, _row(), llm=llm, http_client=MagicMock())

    assert status == "done"
    llm.complete_json_pdf.assert_not_called()
    assert llm.complete_json_text.call_args.kwargs["tier"] == "cheap"
    params = upsert_cur.execute.call_args.args[1]
    assert params["fonte"] == "texto"
    assert params["status"] == "done"
    assert params["modelo"] == "cheap-model"
    assert params["palavras_chave"] == ["lapis", "lapis preto"]
    conn.commit.assert_called()


def test_insufficient_docs_route_to_pdf_tier(patched):
    patched.docs = [_doc(metodo="insuficiente", texto="", pdf_bytes=b"%PDF-1.4")]
    conn, upsert_cur = _conn([])
    llm = _llm()

    status = enrich_one(conn, _row(), llm=llm, http_client=MagicMock())

    assert status == "done"
    llm.complete_json_text.assert_not_called()
    assert llm.complete_json_pdf.call_count == 1
    params = upsert_cur.execute.call_args.args[1]
    assert params["fonte"] == "pdf"
    assert params["modelo"] == "doc-model"


def test_insufficient_doc_without_cached_bytes_is_redownloaded(patched):
    patched.docs = [_doc(metodo="insuficiente", texto="", pdf_bytes=None)]
    patched.urls = [{"sequencial_documento": 1, "url": "https://pncp/doc1"}]
    conn, upsert_cur = _conn([])
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
    assert upsert_cur.execute.call_args.args[1]["fonte"] == "pdf"


def test_oversized_pdfs_fall_back_to_structured(patched):
    big = b"0" * (31 * 1024 * 1024)
    patched.docs = [_doc(metodo="insuficiente", texto="", pdf_bytes=big)]
    conn, upsert_cur = _conn([])
    llm = _llm()

    status = enrich_one(conn, _row(), llm=llm, http_client=MagicMock())

    assert status == "done"
    llm.complete_json_pdf.assert_not_called()
    assert upsert_cur.execute.call_args.args[1]["fonte"] == "estruturado"


def test_no_docs_routes_to_structured(patched):
    patched.docs = []
    conn, upsert_cur = _conn([_item()])
    llm = _llm()

    status = enrich_one(conn, _row(), llm=llm, http_client=MagicMock())

    assert status == "done"
    assert llm.complete_json_text.call_args.kwargs["tier"] == "cheap"
    assert upsert_cur.execute.call_args.args[1]["fonte"] == "estruturado"


# --- embedding -----------------------------------------------------------


def test_successful_row_embeds_canonical_text_into_the_upsert(patched):
    patched.docs = [_doc(metodo="pypdf")]
    conn, upsert_cur = _conn([_item()])
    llm = _llm()

    status = enrich_one(conn, _row(), llm=llm, http_client=MagicMock())

    assert status == "done"
    assert llm.embed.call_args.args[0] == [build_embedding_text(_payload())]
    params = upsert_cur.execute.call_args.args[1]
    assert params["embedding"] == "[0.5,0.5,0.5,0.5]"
    assert params["embedding_modelo"] == "embed-model"


def test_upsert_sql_casts_embedding_to_vector():
    assert "%(embedding)s::vector" in worker._UPSERT_SQL
    assert "embedding_modelo = EXCLUDED.embedding_modelo" in worker._UPSERT_SQL


def test_embed_failure_still_persists_the_enrichment(patched):
    patched.docs = [_doc(metodo="pypdf")]
    conn, upsert_cur = _conn([_item()])
    llm = _llm()
    llm.embed.side_effect = RuntimeError("embeddings down")

    status = enrich_one(conn, _row(), llm=llm, http_client=MagicMock())

    assert status == "done"
    params = upsert_cur.execute.call_args.args[1]
    assert params["status"] == "done"
    assert params["embedding"] is None
    assert params["embedding_modelo"] is None
    assert params["resumo"] == "Compra de lápis."
    conn.commit.assert_called()


def test_error_row_carries_no_embedding(patched):
    conn, upsert_cur = _conn([])
    llm = _llm(payload="not a dict")

    enrich_one(conn, _row(), llm=llm, http_client=MagicMock())

    llm.embed.assert_not_called()
    assert upsert_cur.execute.call_args.args[1]["embedding"] is None


# --- failure handling ----------------------------------------------------


def test_invalid_payload_persists_error_row(patched):
    conn, upsert_cur = _conn([])
    llm = _llm(payload="not a dict")

    status = enrich_one(conn, _row(), llm=llm, http_client=MagicMock())

    assert status == "error"
    params = upsert_cur.execute.call_args.args[1]
    assert params["status"] == "error"
    assert params["erro"] == "resposta inválida"
    assert params["dados"] == "{}"
    conn.commit.assert_called()


def test_sdk_exception_persists_error_row(patched):
    conn, upsert_cur = _conn([])
    llm = MagicMock()
    llm.complete_json_text.side_effect = RuntimeError("provider exploded")

    status = enrich_one(conn, _row(), llm=llm, http_client=MagicMock())

    assert status == "error"
    params = upsert_cur.execute.call_args.args[1]
    assert params["status"] == "error"
    assert "provider exploded" in params["erro"]
    conn.commit.assert_called()


# --- enrich orchestration ------------------------------------------------


def _conn_for_enrich(rows, per_row_cursors=2):
    select_cur = MagicMock()
    select_cur.fetchall.return_value = rows

    cursors = [select_cur]
    upsert_curs = []
    for _ in rows:
        itens_cur = MagicMock()
        itens_cur.fetchall.return_value = []
        upsert_cur = MagicMock()
        upsert_curs.append(upsert_cur)
        cursors.extend([itens_cur, upsert_cur][:per_row_cursors])

    conn = MagicMock()
    conn.cursor.return_value.__enter__.side_effect = cursors
    conn.cursor.return_value.__exit__.return_value = False
    return conn, select_cur, upsert_curs


def test_enrich_passes_days_and_retry_errors_to_sql(patched):
    conn, select_cur, _ = _conn_for_enrich([])

    result = enrich(conn, limit=7, days=30, retry_errors=True, llm=_llm(), http_client=MagicMock())

    assert result == {"processed": 0, "done": 0, "error": 0}
    params = select_cur.execute.call_args.args[1]
    assert params["limit"] == 7
    assert params["days"] == 30
    assert params["retry_errors"] is True
    assert params["portais"] == worker.PORTAIS_ATIVOS


def test_enrich_defaults_are_no_days_no_retry(patched):
    conn, select_cur, _ = _conn_for_enrich([])

    enrich(conn, llm=_llm(), http_client=MagicMock())

    params = select_cur.execute.call_args.args[1]
    assert params["days"] is None
    assert params["retry_errors"] is False
    assert params["limit"] == worker.BATCH_LIMIT_DEFAULT


def test_enrich_isolates_a_failing_row_and_continues(patched):
    conn, _select_cur, upsert_curs = _conn_for_enrich([_row("num-1"), _row("num-2")])
    llm = MagicMock()
    llm.complete_json_text.side_effect = [RuntimeError("boom"), (_payload(), "cheap-model")]

    result = enrich(conn, llm=llm, http_client=MagicMock())

    assert result == {"processed": 2, "done": 1, "error": 1}
    assert upsert_curs[0].execute.call_args.args[1]["status"] == "error"
    assert upsert_curs[1].execute.call_args.args[1]["status"] == "done"
