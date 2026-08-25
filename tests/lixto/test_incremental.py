"""Unit tests for src/lixto/sync/incremental.py.

No network, no live database: the watermark helpers are exercised against
MagicMock cursors, and orchestration monkeypatches the DB-touching helpers
plus `upsert_procurement`/`sync_details`.
"""

from datetime import UTC, date, datetime
from unittest.mock import MagicMock

from lixto.pncp_client import PncpApiError
from lixto.sync import incremental as incremental_module

# --- watermark key / resolve ----------------------------------------------


def test_watermark_key_is_namespaced_per_modality():
    assert incremental_module.watermark_key(6) == "incremental:procurements:6"


def test_resolve_window_start_prefers_existing_watermark():
    assert incremental_module._resolve_window_start(
        "2026-07-15T08:00:00", date(2026, 7, 1), date(2026, 1, 1)
    ) == date(2026, 7, 15)


def test_resolve_window_start_falls_back_to_since():
    assert incremental_module._resolve_window_start(
        None, date(2026, 7, 1), date(2026, 1, 1)
    ) == date(2026, 7, 1)


def test_resolve_window_start_falls_back_to_bootstrap():
    assert incremental_module._resolve_window_start(None, None, date(2026, 1, 1)) == date(
        2026, 1, 1
    )


# --- DB helpers ------------------------------------------------------------


def _mock_conn():
    cursor = MagicMock()
    cursor.fetchone.return_value = (1,)  # agent_runs id
    conn = MagicMock()
    conn.cursor.return_value.__enter__.return_value = cursor
    conn.cursor.return_value.__exit__.return_value = False
    return conn, cursor


def test_get_existing_watermarks_parses_modality_from_key():
    conn, cursor = _mock_conn()
    cursor.fetchall.return_value = [
        ("incremental:procurements:6", "2026-07-15T08:00:00"),
        ("incremental:procurements:8", None),
    ]

    assert incremental_module._get_existing_watermarks(conn) == {
        6: "2026-07-15T08:00:00",
        8: None,
    }


def test_bootstrap_start_date_uses_newest_source_global_updated_at():
    conn, cursor = _mock_conn()
    cursor.fetchone.return_value = (datetime(2026, 7, 20, 10, 0, 0, tzinfo=UTC),)

    assert incremental_module._bootstrap_start_date(conn) == date(2026, 7, 20)


def test_bootstrap_start_date_falls_back_to_today_when_empty():
    conn, cursor = _mock_conn()
    cursor.fetchone.return_value = (None,)

    assert incremental_module._bootstrap_start_date(conn) == datetime.now(UTC).date()


def test_advance_watermark_upserts_sync_state_value():
    conn, cursor = _mock_conn()

    incremental_module._advance_watermark(conn, 6, "2026-07-20T10:00:00")

    executed_sql, executed_params = cursor.execute.call_args.args
    assert "INSERT INTO sync_state" in executed_sql
    assert "ON CONFLICT (key) DO UPDATE" in executed_sql
    assert executed_params["key"] == "incremental:procurements:6"
    assert executed_params["value"].obj == {"watermark": "2026-07-20T10:00:00"}
    conn.commit.assert_called_once()


# --- orchestration ---------------------------------------------------------


def _update_page(dtos, pages_left=0):
    return {"data": dtos, "totalRegistros": len(dtos), "paginasRestantes": pages_left}


def _dto(source_id, updated_at):
    return {"numeroControlePNCP": source_id, "dataAtualizacaoGlobal": updated_at}


def _patch_db_helpers(monkeypatch, *, existing_watermarks=None, bootstrap_date=date(2026, 7, 30)):
    monkeypatch.setattr(
        incremental_module, "_get_existing_watermarks", lambda conn: existing_watermarks or {}
    )
    monkeypatch.setattr(incremental_module, "_bootstrap_start_date", lambda conn: bootstrap_date)
    advance_calls: list[tuple[int, str]] = []
    monkeypatch.setattr(
        incremental_module,
        "_advance_watermark",
        lambda conn, modality, watermark: advance_calls.append((modality, watermark)),
    )
    monkeypatch.setattr(incremental_module, "upsert_procurement", MagicMock())
    monkeypatch.setattr(incremental_module, "sync_details", MagicMock(return_value=0))
    return advance_calls


def test_sync_incremental_advances_watermark_to_max_dto_seen(monkeypatch):
    conn, _cursor = _mock_conn()
    advance_calls = _patch_db_helpers(monkeypatch)

    fake_client = MagicMock()
    fake_client.iter_update_pages.return_value = [
        _update_page([_dto("ctrl-1", "2026-08-01T10:00:00"), _dto("ctrl-2", "2026-08-02T09:00:00")])
    ]

    result = incremental_module.sync_incremental(
        conn, modalities=[6], client=fake_client, until=date(2026, 8, 2)
    )

    assert result["modalities_advanced"] == 1
    assert result["modalities_failed"] == []
    assert result["rows_seen"] == 2
    assert advance_calls == [(6, "2026-08-02T09:00:00")]
    assert incremental_module.upsert_procurement.call_count == 2


def test_sync_incremental_zero_rows_advances_watermark_to_until(monkeypatch):
    conn, _cursor = _mock_conn()
    advance_calls = _patch_db_helpers(monkeypatch)

    fake_client = MagicMock()
    fake_client.iter_update_pages.return_value = [_update_page([])]

    result = incremental_module.sync_incremental(
        conn, modalities=[6], client=fake_client, until=date(2026, 8, 2)
    )

    assert result["rows_seen"] == 0
    assert advance_calls == [(6, "2026-08-02T00:00:00")]


def test_sync_incremental_one_modality_failure_does_not_block_others(monkeypatch):
    conn, _cursor = _mock_conn()
    advance_calls = _patch_db_helpers(monkeypatch)

    fake_client = MagicMock()

    def fake_iter(*, date_from, date_to, modality_id):
        if modality_id == 8:
            raise PncpApiError("boom")
        return iter([_update_page([])])

    fake_client.iter_update_pages.side_effect = fake_iter

    result = incremental_module.sync_incremental(
        conn, modalities=[6, 8, 9], client=fake_client, until=date(2026, 8, 2)
    )

    assert result["modalities_failed"] == [8]
    assert result["modalities_advanced"] == 2
    assert {m for m, _ in advance_calls} == {6, 9}


def test_sync_incremental_uses_existing_watermark_as_window_start(monkeypatch):
    conn, _cursor = _mock_conn()
    _patch_db_helpers(
        monkeypatch,
        existing_watermarks={6: "2026-08-01T00:00:00"},
        bootstrap_date=date(2026, 1, 1),
    )

    fake_client = MagicMock()
    fake_client.iter_update_pages.return_value = [_update_page([])]

    incremental_module.sync_incremental(
        conn, modalities=[6], client=fake_client, until=date(2026, 8, 2)
    )

    fake_client.iter_update_pages.assert_called_once_with(
        date_from="20260801", date_to="20260802", modality_id=6
    )


def test_sync_incremental_loops_sync_details_until_zero_processed(monkeypatch):
    conn, _cursor = _mock_conn()
    _patch_db_helpers(monkeypatch)
    sync_details_mock = MagicMock(side_effect=[100, 40, 0])
    monkeypatch.setattr(incremental_module, "sync_details", sync_details_mock)

    fake_client = MagicMock()
    fake_client.iter_update_pages.return_value = [_update_page([])]

    result = incremental_module.sync_incremental(
        conn,
        modalities=[6],
        client=fake_client,
        until=date(2026, 8, 2),
        details_batch_size=100,
    )

    assert sync_details_mock.call_count == 3
    assert result["details_processed"] == 140


def test_sync_incremental_details_drain_is_bounded_by_max_details(monkeypatch):
    conn, _cursor = _mock_conn()
    _patch_db_helpers(monkeypatch)
    sync_details_mock = MagicMock(side_effect=[100, 100, 100])
    monkeypatch.setattr(incremental_module, "sync_details", sync_details_mock)

    fake_client = MagicMock()
    fake_client.iter_update_pages.return_value = [_update_page([])]

    result = incremental_module.sync_incremental(
        conn,
        modalities=[6],
        client=fake_client,
        until=date(2026, 8, 2),
        details_batch_size=100,
        max_details=200,
    )

    assert sync_details_mock.call_count == 2
    assert result["details_processed"] == 200


def test_sync_incremental_opens_and_closes_an_agent_run(monkeypatch):
    conn, cursor = _mock_conn()
    _patch_db_helpers(monkeypatch)

    fake_client = MagicMock()
    fake_client.iter_update_pages.return_value = [_update_page([])]

    incremental_module.sync_incremental(
        conn, modalities=[6], client=fake_client, until=date(2026, 8, 2)
    )

    sqls = [c.args[0] for c in cursor.execute.call_args_list]
    assert any("INSERT INTO agent_runs" in sql for sql in sqls)
    assert any("UPDATE agent_runs SET status = 'done'" in sql for sql in sqls)
    kind = cursor.execute.call_args_list[0].args[1][0]
    assert kind == "sync.procurements"


def test_sync_incremental_owns_and_closes_the_client_when_none_injected(monkeypatch):
    conn, _cursor = _mock_conn()
    _patch_db_helpers(monkeypatch)

    fake_client = MagicMock()
    fake_client.iter_update_pages.return_value = [_update_page([])]
    monkeypatch.setattr(incremental_module, "PncpClient", MagicMock(return_value=fake_client))

    incremental_module.sync_incremental(conn, modalities=[6], until=date(2026, 8, 2))

    fake_client.close.assert_called_once()
