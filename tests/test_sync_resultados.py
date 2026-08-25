"""Unit tests for src/plic/sync_resultados.py.

Fixture-based, no network and no live database: httpx.MockTransport stands
in for PNCP's resultados endpoint, and MagicMock stands in for the psycopg
connection/cursor.
"""

import json
from pathlib import Path
from unittest.mock import MagicMock

import httpx
import pytest

from plic.pncp_client import PncpApiError, PncpClient
from plic.sync_resultados import (
    _UPSERT_RESULTADO_SQL,
    fetch_resultados,
    row_from_resultado_dto,
    sync_resultados,
    upsert_resultado,
)

FIXTURES_DIR = Path(__file__).parent / "fixtures"


def _load_resultados() -> list[dict]:
    return json.loads((FIXTURES_DIR / "resultados.json").read_text())


@pytest.fixture(autouse=True)
def _no_sleep(monkeypatch):
    from plic import pncp_client

    monkeypatch.setattr(pncp_client.time, "sleep", lambda _seconds: None)


def _client_with_handler(handler) -> PncpClient:
    return PncpClient(
        base_url="https://pncp.gov.br/api/pncp", transport=httpx.MockTransport(handler)
    )


# --- row mapping -------------------------------------------------------


def test_row_from_resultado_dto_maps_live_payload_field_by_field():
    dto = _load_resultados()[0]

    row = row_from_resultado_dto("42498600000171-1-002592/2026", dto)

    assert row["numero_controle_pncp"] == "42498600000171-1-002592/2026"
    assert row["numero_item"] == dto["numeroItem"]
    assert row["sequencial_resultado"] == dto["sequencialResultado"]
    assert row["ni_fornecedor"] == dto["niFornecedor"]
    assert row["nome_razao_social_fornecedor"] == dto["nomeRazaoSocialFornecedor"]
    assert row["tipo_pessoa"] == dto["tipoPessoa"]
    assert row["porte_fornecedor_id"] == dto["porteFornecedorId"]
    assert row["porte_fornecedor_nome"] == dto["porteFornecedorNome"]
    assert row["quantidade_homologada"] == dto["quantidadeHomologada"]
    assert row["valor_unitario_homologado"] == dto["valorUnitarioHomologado"]
    assert row["valor_total_homologado"] == dto["valorTotalHomologado"]
    assert row["percentual_desconto"] == dto["percentualDesconto"]
    assert row["ordem_classificacao_srp"] == dto["ordemClassificacaoSrp"]
    assert row["situacao_compra_item_resultado_id"] == dto["situacaoCompraItemResultadoId"]
    assert row["situacao_compra_item_resultado_nome"] == dto["situacaoCompraItemResultadoNome"]
    assert row["indicador_subcontratacao"] == dto["indicadorSubcontratacao"]
    assert row["data_resultado"] == dto["dataResultado"]
    assert row["data_cancelamento"] == dto["dataCancelamento"]
    assert row["motivo_cancelamento"] == dto["motivoCancelamento"]
    assert row["data_inclusao"] == dto["dataInclusao"]
    assert row["data_atualizacao"] == dto["dataAtualizacao"]
    # reservaRemanescente is a nested object — ignored, not stored
    assert "reserva_remanescente" not in row
    assert "reservaRemanescente" not in row


def test_upsert_resultado_executes_on_conflict_upsert():
    cursor = MagicMock()
    dto = _load_resultados()[0]

    upsert_resultado(cursor, "num-ctrl-1", dto)

    assert cursor.execute.call_count == 1
    executed_sql, executed_params = cursor.execute.call_args.args
    assert executed_sql is _UPSERT_RESULTADO_SQL
    assert (
        "ON CONFLICT (numero_controle_pncp, numero_item, sequencial_resultado) DO UPDATE"
        in executed_sql
    )
    assert executed_params["numero_controle_pncp"] == "num-ctrl-1"
    assert executed_params["numero_item"] == dto["numeroItem"]
    assert executed_params["sequencial_resultado"] == dto["sequencialResultado"]


# --- fetch / paging ------------------------------------------------------


def test_fetch_resultados_returns_first_page_content():
    resultados = _load_resultados()

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=resultados)

    client = _client_with_handler(handler)
    result = fetch_resultados(
        client, orgao_cnpj="123", ano_compra=2026, sequencial_compra=1, numero_item=1
    )
    client.close()

    assert result == resultados


def test_fetch_resultados_404_on_first_page_counts_as_empty():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={"message": "not found"})

    client = _client_with_handler(handler)
    result = fetch_resultados(
        client, orgao_cnpj="123", ano_compra=2026, sequencial_compra=1, numero_item=1
    )
    client.close()

    assert result == []


def test_fetch_resultados_never_requests_a_second_page():
    """Discovered live 2026-08-24: PNCP's /resultados endpoint does not
    paginate — page 2+ echoes page 1 forever (HTTP 200, same content),
    never signaling end-of-data. `_FirstPageOnly` must stop the shared
    paginator after page 1 without a second real request, or this would
    infinite-loop against the live API."""
    resultados = _load_resultados()
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        # A real PNCP server would answer this with the *same* non-empty
        # page 1 content forever, not an empty/204/404 — if fetch_resultados
        # ever asked for it, the paginator would never terminate.
        return httpx.Response(200, json=resultados)

    client = _client_with_handler(handler)
    result = fetch_resultados(
        client, orgao_cnpj="123", ano_compra=2026, sequencial_compra=1, numero_item=1
    )
    client.close()

    assert calls["n"] == 1
    assert result == resultados


# --- sync_resultados orchestration ---------------------------------------


def _conn_with_pending_rows(rows):
    """Build a MagicMock psycopg.Connection whose cursor supports the
    `with conn.cursor() as cur:` pattern, and whose SELECT for pending items
    returns `rows`."""
    select_cursor = MagicMock()
    select_cursor.fetchall.return_value = rows

    upsert_cursor = MagicMock()

    conn = MagicMock()
    conn.cursor.return_value.__enter__.side_effect = [select_cursor] + [upsert_cursor] * len(
        rows
    )
    conn.cursor.return_value.__exit__.return_value = False
    return conn, select_cursor, upsert_cursor


def test_sync_resultados_fetches_upserts_and_stamps():
    resultados = _load_resultados()

    rows = [("num-ctrl-1", 1, "00360305000104", 2023, 52)]
    conn, _select_cursor, upsert_cursor = _conn_with_pending_rows(rows)

    fake_client = MagicMock()

    def fake_get(path, params):
        pagina = params["pagina"]
        return httpx.Response(200, json=resultados if pagina == 1 else [])

    fake_client._get.side_effect = fake_get

    processed = sync_resultados(conn, client=fake_client)

    assert processed == 1
    # 1 resultado upsert + 1 stamping UPDATE
    assert upsert_cursor.execute.call_count == 2
    stamp_sql = upsert_cursor.execute.call_args_list[-1].args[0]
    assert "resultados_sincronizados_em = now()" in stamp_sql
    conn.commit.assert_called()
    fake_client.close.assert_not_called()


def test_sync_resultados_stamps_even_when_array_empty():
    rows = [("num-ctrl-1", 1, "00360305000104", 2023, 52)]
    conn, _select_cursor, upsert_cursor = _conn_with_pending_rows(rows)

    fake_client = MagicMock()
    fake_client._get.return_value = httpx.Response(200, json=[])

    processed = sync_resultados(conn, client=fake_client)

    assert processed == 1
    assert upsert_cursor.execute.call_count == 1  # only the stamping UPDATE
    stamp_sql = upsert_cursor.execute.call_args_list[-1].args[0]
    assert "resultados_sincronizados_em = now()" in stamp_sql


def test_sync_resultados_404_on_first_page_yields_zero_rows_and_still_stamps():
    rows = [("num-ctrl-1", 1, "00360305000104", 2023, 52)]
    conn, _select_cursor, upsert_cursor = _conn_with_pending_rows(rows)

    fake_client = MagicMock()
    fake_client._get.return_value = httpx.Response(404, json={"message": "not found"})

    processed = sync_resultados(conn, client=fake_client)

    assert processed == 1
    assert upsert_cursor.execute.call_count == 1  # only the stamping UPDATE
    stamp_sql = upsert_cursor.execute.call_args_list[-1].args[0]
    assert "resultados_sincronizados_em = now()" in stamp_sql


def test_sync_resultados_skips_item_that_fails_after_retries():
    rows = [
        ("num-ctrl-fail", 1, "00360305000104", 2023, 52),
        ("num-ctrl-ok", 1, "00360305000104", 2023, 53),
    ]
    select_cursor = MagicMock()
    select_cursor.fetchall.return_value = rows
    upsert_cursor = MagicMock()

    conn = MagicMock()
    conn.cursor.return_value.__enter__.side_effect = [select_cursor, upsert_cursor]
    conn.cursor.return_value.__exit__.return_value = False

    fake_client = MagicMock()

    def fake_get(path, params):
        if "num-ctrl-fail" in path or "52" in path:
            raise PncpApiError("boom")
        return httpx.Response(200, json=[])

    fake_client._get.side_effect = fake_get

    processed = sync_resultados(conn, client=fake_client)

    assert processed == 1


def test_sync_resultados_applies_limit():
    rows = [("num-ctrl-1", 1, "cnpj", 2026, 1)]
    select_cursor = MagicMock()
    select_cursor.fetchall.return_value = rows
    upsert_cursor = MagicMock()
    conn = MagicMock()
    conn.cursor.return_value.__enter__.side_effect = [select_cursor, upsert_cursor]
    conn.cursor.return_value.__exit__.return_value = False

    fake_client = MagicMock()
    fake_client._get.return_value = httpx.Response(200, json=[])

    sync_resultados(conn, limit=5, client=fake_client)

    executed_sql, executed_params = select_cursor.execute.call_args.args
    assert "LIMIT %(limit)s" in executed_sql
    assert executed_params["limit"] == 5


def test_sync_resultados_no_limit_omits_limit_clause():
    select_cursor = MagicMock()
    select_cursor.fetchall.return_value = []
    conn = MagicMock()
    conn.cursor.return_value.__enter__.return_value = select_cursor
    conn.cursor.return_value.__exit__.return_value = False

    fake_client = MagicMock()

    processed = sync_resultados(conn, client=fake_client)

    assert processed == 0
    executed_sql = select_cursor.execute.call_args.args[0]
    assert "LIMIT" not in executed_sql
