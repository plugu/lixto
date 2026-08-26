"""Unit tests for src/lixto/sync/results.py.

No network, no live database: the PNCP client is a MagicMock exposing
`fetch_item_results`, and psycopg cursors/connections are MagicMocks.
"""

from unittest.mock import MagicMock

from lixto.pncp_client import PncpApiError
from lixto.sync import results as results_module
from lixto.sync.results import (
    _UPSERT_RESULT_SQL,
    row_from_result_dto,
    sync_results,
    upsert_result,
)


def _result_dto(**overrides) -> dict:
    dto = {
        "numeroItem": 1,
        "sequencialResultado": 1,
        "niFornecedor": "12345678000199",
        "nomeRazaoSocialFornecedor": "Agro Sementes LTDA",
        "tipoPessoa": "PJ",
        "porteFornecedorId": 2,
        "porteFornecedorNome": "Empresa de Pequeno Porte",
        "quantidadeHomologada": 3500.0,
        "valorUnitarioHomologado": 12.9,
        "valorTotalHomologado": 45150.0,
        "percentualDesconto": 6.18,
        "ordemClassificacaoSrp": 1,
        "situacaoCompraItemResultadoId": 1,
        "situacaoCompraItemResultadoNome": "Homologado",
        "indicadorSubcontratacao": False,
        "dataResultado": "2026-02-10",
        "dataCancelamento": None,
        "motivoCancelamento": None,
        "dataInclusao": "2026-02-10T14:32:00",
        "dataAtualizacao": "2026-02-10T14:32:00",
        "reservaRemanescente": {"codigo": 0, "nome": "Não se aplica"},
    }
    dto.update(overrides)
    return dto


# --- row mapping -------------------------------------------------------


def test_row_from_result_dto_maps_adr_columns():
    dto = _result_dto()

    row = row_from_result_dto(7, 1, dto)

    assert row["procurement_id"] == 7
    assert row["item_number"] == 1
    assert row["sequence"] == dto["sequencialResultado"]
    assert row["supplier_tax_id"] == dto["niFornecedor"]
    assert row["supplier_name"] == dto["nomeRazaoSocialFornecedor"]
    assert row["supplier_kind"] == dto["tipoPessoa"]
    assert row["supplier_size_id"] == dto["porteFornecedorId"]
    assert row["supplier_size_name"] == dto["porteFornecedorNome"]
    assert row["awarded_quantity"] == dto["quantidadeHomologada"]
    assert row["awarded_unit_price"] == dto["valorUnitarioHomologado"]
    assert row["awarded_total"] == dto["valorTotalHomologado"]
    assert row["discount_pct"] == dto["percentualDesconto"]
    assert row["price_registry_rank"] == dto["ordemClassificacaoSrp"]
    assert row["status_id"] == dto["situacaoCompraItemResultadoId"]
    assert row["status_name"] == dto["situacaoCompraItemResultadoNome"]
    assert row["has_subcontracting"] == dto["indicadorSubcontratacao"]
    assert row["result_date"] == dto["dataResultado"]
    assert row["cancelled_at"] == dto["dataCancelamento"]
    assert row["cancel_reason"] == dto["motivoCancelamento"]
    assert row["source_created_at"] == dto["dataInclusao"]
    assert row["source_updated_at"] == dto["dataAtualizacao"]
    # reservaRemanescente is a nested object — ignored, not stored
    assert "reserva_remanescente" not in row
    assert "reservaRemanescente" not in row


def test_upsert_result_executes_on_conflict_upsert():
    cursor = MagicMock()

    upsert_result(cursor, 7, 1, _result_dto())

    executed_sql, executed_params = cursor.execute.call_args.args
    assert executed_sql is _UPSERT_RESULT_SQL
    assert "ON CONFLICT (procurement_id, item_number, sequence) DO UPDATE" in executed_sql
    assert executed_params["procurement_id"] == 7
    assert executed_params["item_number"] == 1
    assert executed_params["sequence"] == _result_dto()["sequencialResultado"]


# --- orchestration -----------------------------------------------------


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


def _client(results=None):
    client = MagicMock()
    client.fetch_item_results.return_value = results if results is not None else []
    return client


def test_sync_results_upserts_results_payload_and_stamps():
    rows = [(7, 1, "00360305000104-1-000052/2026", "00360305000104", 2026, 52)]
    conn, _select_cursor, write_cursor = _conn_with_pending(rows)
    results = [_result_dto(), _result_dto(sequencialResultado=2)]
    client = _client(results=results)

    processed = sync_results(conn, client=client)

    assert processed == 1
    client.fetch_item_results.assert_called_once_with(
        agency_tax_id="00360305000104", year=2026, sequence=52, item_number=1
    )
    sqls = [c.args[0] for c in write_cursor.execute.call_args_list]
    # 2 result upserts + 1 payload + 1 stamp
    assert len(sqls) == 4
    payload_calls = [
        c.args[1] for c in write_cursor.execute.call_args_list if "source_payloads" in c.args[0]
    ]
    assert payload_calls[0]["entity_type"] == "procurement_results"
    assert payload_calls[0]["external_id"] == "00360305000104-1-000052/2026#1"
    assert len(payload_calls[0]["payload"].obj) == 2
    assert "results_synced_at = now()" in sqls[-1]
    conn.commit.assert_called()
    client.close.assert_not_called()


def test_sync_results_stamps_even_when_array_empty():
    rows = [(7, 1, "ctrl-1", "00360305000104", 2026, 52)]
    conn, _select_cursor, write_cursor = _conn_with_pending(rows)

    processed = sync_results(conn, client=_client())

    assert processed == 1
    sqls = [c.args[0] for c in write_cursor.execute.call_args_list]
    assert len(sqls) == 2  # (empty) payload + the stamp
    assert "results_synced_at = now()" in sqls[-1]


def test_sync_results_counts_into_run_counters():
    rows = [(7, 1, "ctrl-1", "00360305000104", 2026, 52)]
    conn, _select_cursor, _write_cursor = _conn_with_pending(rows)
    counters = MagicMock()

    sync_results(conn, client=_client(results=[_result_dto()]), counters=counters)

    assert ("results_processed",) in [c.args for c in counters.inc.call_args_list]
    assert ("results", 1) in [c.args for c in counters.inc.call_args_list]


def test_sync_results_skips_item_that_fails_after_retries():
    rows = [
        (7, 1, "ctrl-fail", "00360305000104", 2026, 52),
        (8, 1, "ctrl-ok", "00360305000104", 2026, 53),
    ]
    conn, _select_cursor, _write_cursor = _conn_with_pending(rows)
    client = _client()
    client.fetch_item_results.side_effect = [PncpApiError("boom"), []]

    processed = sync_results(conn, client=client)

    assert processed == 1


def test_sync_results_stamps_items_without_year_or_sequence():
    rows = [(7, 1, "ctrl-1", "00360305000104", None, None)]
    conn, _select_cursor, write_cursor = _conn_with_pending(rows)
    client = _client()

    processed = sync_results(conn, client=client)

    assert processed == 0
    client.fetch_item_results.assert_not_called()
    assert "results_synced_at = now()" in write_cursor.execute.call_args.args[0]


def test_sync_results_applies_limit():
    conn, select_cursor, _write_cursor = _conn_with_pending([])

    sync_results(conn, limit=5, client=_client())

    executed_sql, executed_params = select_cursor.execute.call_args.args
    assert "LIMIT %(limit)s" in executed_sql
    assert executed_params["limit"] == 5


def test_sync_results_without_limit_reads_the_queue_in_batches():
    # Never one unbounded fetchall(): the demand queue is read BATCH_SIZE at
    # a time even when the caller passes no limit.
    conn, select_cursor, _write_cursor = _conn_with_pending([])

    assert sync_results(conn, client=_client()) == 0

    executed_sql, executed_params = select_cursor.execute.call_args.args
    assert "LIMIT %(limit)s" in executed_sql
    assert executed_params["limit"] == results_module.BATCH_SIZE
    assert "OFFSET" not in executed_sql


def test_sync_results_fetches_a_second_batch_when_the_first_fills_up(monkeypatch):
    monkeypatch.setattr(results_module, "BATCH_SIZE", 2)
    first = [
        (7, 1, "ctrl-1", "00360305000104", 2026, 52),
        (8, 1, "ctrl-2", "00360305000104", 2026, 53),
    ]
    second = [(9, 1, "ctrl-3", "00360305000104", 2026, 54)]
    # one shared cursor: `fetchall` drives the batches, the writes land on it
    cursor = MagicMock()
    cursor.fetchall.side_effect = [first, second]
    conn = MagicMock()
    conn.cursor.return_value.__enter__.return_value = cursor
    conn.cursor.return_value.__exit__.return_value = False

    assert sync_results(conn, client=_client()) == 3
    assert cursor.fetchall.call_count == 2


def test_sync_results_offsets_past_items_it_could_not_stamp(monkeypatch):
    # A failed fetch leaves the item at the front of the queue; without the
    # offset the next batch would hand back the same row forever.
    monkeypatch.setattr(results_module, "BATCH_SIZE", 1)
    select_cursor = MagicMock()
    select_cursor.fetchall.side_effect = [
        [(7, 1, "ctrl-fail", "00360305000104", 2026, 52)],
        [],
    ]
    conn = MagicMock()
    conn.cursor.return_value.__enter__.return_value = select_cursor
    conn.cursor.return_value.__exit__.return_value = False
    client = _client()
    client.fetch_item_results.side_effect = PncpApiError("boom")

    assert sync_results(conn, client=client) == 0

    second_sql, second_params = select_cursor.execute.call_args.args
    assert "OFFSET %(offset)s" in second_sql
    assert second_params["offset"] == 1
