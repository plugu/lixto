"""Unit tests for src/lixto/sync/details.py.

No network, no live database: the PNCP client is a MagicMock exposing
`fetch_items`/`fetch_documents`, and psycopg cursors/connections are
MagicMocks.
"""

from unittest.mock import MagicMock

import pytest

from lixto.pncp_client import PncpApiError
from lixto.sync.details import (
    _UPSERT_DOCUMENT_SQL,
    _UPSERT_ITEM_SQL,
    item_kind,
    row_from_document_dto,
    row_from_item_dto,
    sync_details,
    upsert_document,
    upsert_item,
)


def _item_dto(**overrides) -> dict:
    dto = {
        "numeroItem": 1,
        "descricao": "Luva cirúrgica estéril",
        "materialOuServico": "M",
        "materialOuServicoNome": "Material",
        "quantidade": 1000,
        "unidadeMedida": "CAIXA",
        "valorUnitarioEstimado": 12.5,
        "valorTotal": 12500.0,
        "criterioJulgamentoId": 1,
        "criterioJulgamentoNome": "Menor preço",
        "situacaoCompraItem": 1,
        "situacaoCompraItemNome": "Em andamento",
        "tipoBeneficio": 4,
        "tipoBeneficioNome": "Sem benefício",
        "ncmNbsCodigo": None,
        "catalogoCodigoItem": None,
        "dataInclusao": "2026-08-19T13:55:00",
        "dataAtualizacao": "2026-08-19T14:00:00",
    }
    dto.update(overrides)
    return dto


def _document_dto(**overrides) -> dict:
    dto = {
        "sequencialDocumento": 1,
        "titulo": "Edital.pdf",
        "tipoDocumentoId": 2,
        "tipoDocumentoNome": "Edital",
        "tipoDocumentoDescricao": "Edital de licitação",
        "url": "https://pncp.gov.br/pncp-api/v1/orgaos/x/compras/2026/52/arquivos/1",
        "statusAtivo": True,
        "dataPublicacaoPncp": "2026-08-19T14:00:00",
    }
    dto.update(overrides)
    return dto


# --- row mapping -----------------------------------------------------------


@pytest.mark.parametrize(
    ("value", "expected"),
    [("M", "material"), ("S", "service"), ("m", "material"), ("O", None), (None, None), (1, None)],
)
def test_item_kind_maps_material_or_service(value, expected):
    assert item_kind(value) == expected


def test_row_from_item_dto_maps_adr_columns():
    dto = _item_dto()

    row = row_from_item_dto(7, dto)

    assert row["procurement_id"] == 7
    assert row["item_number"] == 1
    assert row["kind"] == "material"
    assert row["quantity"] == 1000
    assert row["unit"] == "CAIXA"
    assert row["estimated_unit_price"] == 12.5
    assert row["estimated_total"] == 12500.0
    # Verified live 2026-08-01: id/name pairs, not nested objects.
    assert row["status_id"] == dto["situacaoCompraItem"]
    assert row["status_name"] == dto["situacaoCompraItemNome"]
    assert row["benefit_type_id"] == dto["tipoBeneficio"]
    assert row["benefit_type_name"] == dto["tipoBeneficioNome"]
    assert row["source_updated_at"] == dto["dataAtualizacao"]


def test_row_from_document_dto_stores_url_verbatim():
    dto = _document_dto()

    row = row_from_document_dto(7, dto)

    assert row["procurement_id"] == 7
    assert row["sequence"] == 1
    assert row["url"] == dto["url"]
    assert row["type_id"] == 2
    assert row["is_active"] is True


def test_upsert_item_executes_on_conflict_upsert():
    cursor = MagicMock()

    upsert_item(cursor, 7, _item_dto())

    executed_sql, executed_params = cursor.execute.call_args.args
    assert executed_sql is _UPSERT_ITEM_SQL
    assert "ON CONFLICT (procurement_id, item_number) DO UPDATE" in executed_sql
    assert executed_params["procurement_id"] == 7


def test_upsert_document_executes_on_conflict_upsert():
    cursor = MagicMock()

    upsert_document(cursor, 7, _document_dto())

    executed_sql, executed_params = cursor.execute.call_args.args
    assert executed_sql is _UPSERT_DOCUMENT_SQL
    assert "ON CONFLICT (procurement_id, sequence) DO UPDATE" in executed_sql
    assert executed_params["url"] == _document_dto()["url"]


# --- orchestration ---------------------------------------------------------


def _conn_with_pending(rows):
    """MagicMock connection whose first cursor answers the pending SELECT and
    whose later cursors receive the upserts/stamps."""
    select_cursor = MagicMock()
    select_cursor.fetchall.return_value = rows
    write_cursor = MagicMock()

    conn = MagicMock()
    conn.cursor.return_value.__enter__.side_effect = [select_cursor] + [write_cursor] * 10
    conn.cursor.return_value.__exit__.return_value = False
    return conn, select_cursor, write_cursor


def _client(items=None, documents=None):
    client = MagicMock()
    client.fetch_items.return_value = items if items is not None else []
    client.fetch_documents.return_value = documents if documents is not None else []
    return client


def test_sync_details_upserts_items_documents_payloads_and_stamps():
    rows = [(7, "00360305000104-1-000052/2026", "00360305000104", 2026, 52)]
    conn, _select_cursor, write_cursor = _conn_with_pending(rows)
    client = _client(items=[_item_dto(), _item_dto(numeroItem=2)], documents=[_document_dto()])

    processed = sync_details(conn, client=client)

    assert processed == 1
    client.fetch_items.assert_called_once_with(
        agency_tax_id="00360305000104", year=2026, sequence=52
    )
    sqls = [c.args[0] for c in write_cursor.execute.call_args_list]
    # 2 items + 1 document + 2 payloads + 1 stamp
    assert len(sqls) == 6
    payload_calls = [
        c.args[1] for c in write_cursor.execute.call_args_list if "source_payloads" in c.args[0]
    ]
    assert [p["entity_type"] for p in payload_calls] == [
        "procurement_items",
        "procurement_documents",
    ]
    assert len(payload_calls[0]["payload"].obj) == 2
    assert "items_synced_at = now()" in sqls[-1]
    assert "documents_synced_at = now()" in sqls[-1]
    conn.commit.assert_called()
    client.close.assert_not_called()


def test_sync_details_stamps_even_when_both_arrays_empty():
    rows = [(7, "ctrl-1", "00360305000104", 2026, 52)]
    conn, _select_cursor, write_cursor = _conn_with_pending(rows)

    processed = sync_details(conn, client=_client())

    assert processed == 1
    sqls = [c.args[0] for c in write_cursor.execute.call_args_list]
    assert len(sqls) == 3  # two (empty) payloads + the stamp
    assert "items_synced_at = now()" in sqls[-1]


def test_sync_details_counts_into_run_counters():
    rows = [(7, "ctrl-1", "00360305000104", 2026, 52)]
    conn, _select_cursor, _write_cursor = _conn_with_pending(rows)
    counters = MagicMock()

    sync_details(conn, client=_client(items=[_item_dto()]), counters=counters)

    assert ("details_processed",) in [c.args for c in counters.inc.call_args_list]
    assert ("items", 1) in [c.args for c in counters.inc.call_args_list]


def test_sync_details_skips_procurement_that_fails_after_retries():
    rows = [
        (7, "ctrl-fail", "00360305000104", 2026, 52),
        (8, "ctrl-ok", "00360305000104", 2026, 53),
    ]
    conn, _select_cursor, _write_cursor = _conn_with_pending(rows)
    client = _client()
    client.fetch_items.side_effect = [PncpApiError("boom"), []]

    processed = sync_details(conn, client=client)

    assert processed == 1


def test_sync_details_stamps_rows_without_year_or_sequence():
    rows = [(7, "ctrl-1", "00360305000104", None, None)]
    conn, _select_cursor, write_cursor = _conn_with_pending(rows)
    client = _client()

    processed = sync_details(conn, client=client)

    assert processed == 0
    client.fetch_items.assert_not_called()
    assert "items_synced_at = now()" in write_cursor.execute.call_args.args[0]


def test_sync_details_applies_limit():
    conn, select_cursor, _write_cursor = _conn_with_pending([])

    sync_details(conn, limit=5, client=_client())

    executed_sql, executed_params = select_cursor.execute.call_args.args
    assert "LIMIT %(limit)s" in executed_sql
    assert executed_params["limit"] == 5


def test_sync_details_no_limit_omits_limit_clause():
    conn, select_cursor, _write_cursor = _conn_with_pending([])

    assert sync_details(conn, client=_client()) == 0
    assert "LIMIT" not in select_cursor.execute.call_args.args[0]
