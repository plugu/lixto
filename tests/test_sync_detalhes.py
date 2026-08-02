"""Unit tests for src/plic/sync_detalhes.py.

Fixture-based, no network and no live database: httpx.MockTransport stands
in for PNCP's itens/arquivos endpoints, and MagicMock stands in for the
psycopg connection/cursor.
"""

import json
from pathlib import Path
from unittest.mock import MagicMock

import httpx
import pytest

from plic.pncp_client import PncpApiError, PncpClient
from plic.sync_detalhes import (
    _UPSERT_ITEM_SQL,
    fetch_arquivos,
    fetch_itens,
    row_from_documento_dto,
    row_from_item_dto,
    sync_detalhes,
    upsert_documento,
    upsert_item,
)

FIXTURES_DIR = Path(__file__).parent / "fixtures"


def _load_itens() -> list[dict]:
    return json.loads((FIXTURES_DIR / "itens.json").read_text())


def _load_arquivos() -> list[dict]:
    return json.loads((FIXTURES_DIR / "arquivos.json").read_text())


@pytest.fixture(autouse=True)
def _no_sleep(monkeypatch):
    from plic import pncp_client

    monkeypatch.setattr(pncp_client.time, "sleep", lambda _seconds: None)


def _client_with_handler(handler) -> PncpClient:
    return PncpClient(
        base_url="https://pncp.gov.br/api/pncp", transport=httpx.MockTransport(handler)
    )


# --- row mapping -------------------------------------------------------


def test_row_from_item_dto_maps_situacao_and_tipo_beneficio_as_id_nome_pairs():
    dto = _load_itens()[0]

    row = row_from_item_dto("00360305000104-1-000052/2023", dto)

    # Verified live 2026-08-01: situacaoCompraItem/tipoBeneficio are ints
    # with separate ...Nome strings, matching the id/nome columns as-is.
    assert row["situacao_compra_item_id"] == dto["situacaoCompraItem"]
    assert row["situacao_compra_item_nome"] == dto["situacaoCompraItemNome"]
    assert row["tipo_beneficio_id"] == dto["tipoBeneficio"]
    assert row["tipo_beneficio_nome"] == dto["tipoBeneficioNome"]
    assert row["numero_item"] == dto["numeroItem"]
    assert row["raw"].obj == dto


def test_row_from_documento_dto_stores_url_verbatim():
    dto = _load_arquivos()[0]

    row = row_from_documento_dto("00360305000104-1-000052/2023", dto)

    assert row["url"] == dto["url"]
    assert row["sequencial_documento"] == dto["sequencialDocumento"]
    assert row["tipo_documento_id"] == dto["tipoDocumentoId"]
    assert row["raw"].obj == dto


def test_upsert_item_executes_on_conflict_upsert():
    cursor = MagicMock()
    dto = _load_itens()[0]

    upsert_item(cursor, "num-ctrl-1", dto)

    assert cursor.execute.call_count == 1
    executed_sql, executed_params = cursor.execute.call_args.args
    assert executed_sql is _UPSERT_ITEM_SQL
    assert "ON CONFLICT (numero_controle_pncp, numero_item) DO UPDATE" in executed_sql
    assert executed_params["numero_controle_pncp"] == "num-ctrl-1"
    assert executed_params["numero_item"] == dto["numeroItem"]


def test_upsert_item_idempotent_same_params_on_repeated_call():
    cursor = MagicMock()
    dto = _load_itens()[0]

    upsert_item(cursor, "num-ctrl-1", dto)
    upsert_item(cursor, "num-ctrl-1", dto)

    assert cursor.execute.call_count == 2
    first_params = cursor.execute.call_args_list[0].args[1]
    second_params = cursor.execute.call_args_list[1].args[1]
    assert {k: v for k, v in first_params.items() if k != "raw"} == {
        k: v for k, v in second_params.items() if k != "raw"
    }


def test_upsert_documento_executes_on_conflict_upsert():
    cursor = MagicMock()
    dto = _load_arquivos()[0]

    upsert_documento(cursor, "num-ctrl-1", dto)

    executed_sql, executed_params = cursor.execute.call_args.args
    assert "ON CONFLICT (numero_controle_pncp, sequencial_documento) DO UPDATE" in executed_sql
    assert executed_params["url"] == dto["url"]


# --- fetch / paging ------------------------------------------------------


def test_fetch_itens_pages_until_empty_array():
    itens = _load_itens()
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        pagina = int(request.url.params["pagina"])
        if pagina == 1:
            return httpx.Response(200, json=itens)
        return httpx.Response(200, json=[])

    client = _client_with_handler(handler)
    result = fetch_itens(client, orgao_cnpj="123", ano_compra=2026, sequencial_compra=1)
    client.close()

    assert calls["n"] == 2
    assert result == itens


def test_fetch_itens_empty_array_on_first_page_returns_empty_list():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=[])

    client = _client_with_handler(handler)
    result = fetch_itens(client, orgao_cnpj="123", ano_compra=2026, sequencial_compra=1)
    client.close()

    assert result == []


def test_fetch_itens_404_on_first_page_counts_as_empty():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={"message": "Contratação não cadastrada."})

    client = _client_with_handler(handler)
    result = fetch_itens(client, orgao_cnpj="123", ano_compra=2026, sequencial_compra=1)
    client.close()

    assert result == []


def test_fetch_itens_204_on_later_page_stops_pagination():
    itens = _load_itens()

    def handler(request: httpx.Request) -> httpx.Response:
        pagina = int(request.url.params["pagina"])
        if pagina == 1:
            return httpx.Response(200, json=itens)
        return httpx.Response(204)

    client = _client_with_handler(handler)
    result = fetch_itens(client, orgao_cnpj="123", ano_compra=2026, sequencial_compra=1)
    client.close()

    assert result == itens


def test_fetch_arquivos_404_on_first_page_counts_as_empty():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={"message": "not found"})

    client = _client_with_handler(handler)
    result = fetch_arquivos(client, orgao_cnpj="123", ano_compra=2026, sequencial_compra=1)
    client.close()

    assert result == []


def test_fetch_itens_raises_on_unexpected_status_after_retries():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, text="<html>server error</html>")

    client = _client_with_handler(handler)
    with pytest.raises(PncpApiError):
        fetch_itens(client, orgao_cnpj="123", ano_compra=2026, sequencial_compra=1)
    client.close()


# --- sync_detalhes orchestration -----------------------------------------


def _conn_with_pending_rows(rows):
    """Build a MagicMock psycopg.Connection whose cursor supports the
    `with conn.cursor() as cur:` pattern, and whose SELECT for pending
    licitações returns `rows`."""
    select_cursor = MagicMock()
    select_cursor.fetchall.return_value = rows

    upsert_cursor = MagicMock()

    conn = MagicMock()
    conn.cursor.return_value.__enter__.side_effect = [select_cursor, upsert_cursor, upsert_cursor]
    conn.cursor.return_value.__exit__.return_value = False
    return conn, select_cursor, upsert_cursor


def test_sync_detalhes_fetches_upserts_and_stamps_both_columns():
    itens = _load_itens()
    arquivos = _load_arquivos()

    rows = [("num-ctrl-1", "00360305000104", 2023, 52)]
    conn, _select_cursor, upsert_cursor = _conn_with_pending_rows(rows)

    fake_client = MagicMock()

    def fake_get(path, params):
        pagina = params["pagina"]
        if "itens" in path:
            return httpx.Response(200, json=itens if pagina == 1 else [])
        return httpx.Response(200, json=arquivos if pagina == 1 else [])

    fake_client._get.side_effect = fake_get

    processed = sync_detalhes(conn, client=fake_client)

    assert processed == 1
    # 2 item upserts + 1 documento upsert + 1 stamping UPDATE
    assert upsert_cursor.execute.call_count == 4
    stamp_sql = upsert_cursor.execute.call_args_list[-1].args[0]
    assert "itens_sincronizados_em = now()" in stamp_sql
    assert "arquivos_sincronizados_em = now()" in stamp_sql
    conn.commit.assert_called()
    fake_client.close.assert_not_called()


def test_sync_detalhes_stamps_even_when_both_arrays_empty():
    rows = [("num-ctrl-1", "00360305000104", 2023, 52)]
    conn, _select_cursor, upsert_cursor = _conn_with_pending_rows(rows)

    fake_client = MagicMock()
    fake_client._get.return_value = httpx.Response(200, json=[])

    processed = sync_detalhes(conn, client=fake_client)

    assert processed == 1
    assert upsert_cursor.execute.call_count == 1  # only the stamping UPDATE
    stamp_sql = upsert_cursor.execute.call_args_list[-1].args[0]
    assert "itens_sincronizados_em = now()" in stamp_sql


def test_sync_detalhes_skips_licitacao_that_fails_after_retries():
    rows = [
        ("num-ctrl-fail", "00360305000104", 2023, 52),
        ("num-ctrl-ok", "00360305000104", 2023, 53),
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

    processed = sync_detalhes(conn, client=fake_client)

    assert processed == 1


def test_sync_detalhes_applies_limit():
    rows = [("num-ctrl-1", "cnpj", 2026, 1)]
    select_cursor = MagicMock()
    select_cursor.fetchall.return_value = rows
    upsert_cursor = MagicMock()
    conn = MagicMock()
    conn.cursor.return_value.__enter__.side_effect = [select_cursor, upsert_cursor]
    conn.cursor.return_value.__exit__.return_value = False

    fake_client = MagicMock()
    fake_client._get.return_value = httpx.Response(200, json=[])

    sync_detalhes(conn, limit=5, client=fake_client)

    executed_sql, executed_params = select_cursor.execute.call_args.args
    assert "LIMIT %(limit)s" in executed_sql
    assert executed_params["limit"] == 5


def test_sync_detalhes_no_limit_omits_limit_clause():
    select_cursor = MagicMock()
    select_cursor.fetchall.return_value = []
    conn = MagicMock()
    conn.cursor.return_value.__enter__.return_value = select_cursor
    conn.cursor.return_value.__exit__.return_value = False

    fake_client = MagicMock()

    processed = sync_detalhes(conn, client=fake_client)

    assert processed == 0
    executed_sql = select_cursor.execute.call_args.args[0]
    assert "LIMIT" not in executed_sql
