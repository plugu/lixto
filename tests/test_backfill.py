"""Unit tests for src/lixto/sync/backfill.py.

No network, no live database: chunk generation is pure-function tested;
orchestration runs against MagicMock connections with `sync_publications`/
`sync_details` monkeypatched, so nothing touches psycopg or httpx.
"""

from datetime import date
from unittest.mock import MagicMock

import pytest
from typer.testing import CliRunner

from lixto.cli import backfill as cli_backfill_module
from lixto.pncp_client import PncpApiError
from lixto.sync import backfill as backfill_module
from lixto.sync.backfill import backfill_unit_key, generate_chunks

runner = CliRunner()

# --- generate_chunks -------------------------------------------------------


def test_generate_chunks_splits_into_7_day_windows():
    assert generate_chunks(date(2026, 1, 1), date(2026, 1, 14)) == [
        (date(2026, 1, 1), date(2026, 1, 7)),
        (date(2026, 1, 8), date(2026, 1, 14)),
    ]


def test_generate_chunks_partial_last_chunk():
    assert generate_chunks(date(2026, 1, 1), date(2026, 1, 10)) == [
        (date(2026, 1, 1), date(2026, 1, 7)),
        (date(2026, 1, 8), date(2026, 1, 10)),
    ]


def test_generate_chunks_single_day_range():
    assert generate_chunks(date(2026, 1, 2), date(2026, 1, 2)) == [
        (date(2026, 1, 2), date(2026, 1, 2))
    ]


def test_generate_chunks_since_after_until_returns_empty():
    assert generate_chunks(date(2026, 1, 10), date(2026, 1, 1)) == []


def test_generate_chunks_exact_multiple_has_no_trailing_short_chunk():
    assert generate_chunks(date(2026, 1, 1), date(2026, 1, 7)) == [
        (date(2026, 1, 1), date(2026, 1, 7))
    ]


def test_generate_chunks_custom_chunk_days():
    assert generate_chunks(date(2026, 1, 1), date(2026, 1, 5), chunk_days=2) == [
        (date(2026, 1, 1), date(2026, 1, 2)),
        (date(2026, 1, 3), date(2026, 1, 4)),
        (date(2026, 1, 5), date(2026, 1, 5)),
    ]


def test_backfill_unit_key_format():
    assert backfill_unit_key(3, date(2026, 1, 8)) == "backfill:3:2026-01-08"


# --- orchestration ---------------------------------------------------------


def _mock_conn(done_keys: set[str]):
    cursor = MagicMock()
    cursor.fetchall.return_value = [(k,) for k in done_keys]
    cursor.fetchone.return_value = (1,)  # agent_runs id

    conn = MagicMock()
    conn.cursor.return_value.__enter__.return_value = cursor
    conn.cursor.return_value.__exit__.return_value = False
    return conn, cursor


@pytest.fixture(autouse=True)
def _no_real_work(monkeypatch):
    monkeypatch.setattr(backfill_module, "sync_publications", MagicMock(return_value={3: 5}))
    monkeypatch.setattr(backfill_module, "sync_details", MagicMock(return_value=0))


def test_backfill_skips_units_already_done():
    conn, _cursor = _mock_conn({"backfill:3:2026-01-01"})
    fake_client = MagicMock()

    result = backfill_module.backfill(
        conn,
        since=date(2026, 1, 1),
        until=date(2026, 1, 2),
        modalities=[3],
        chunk_days=1,
        client=fake_client,
    )

    assert result["units_total"] == 2
    assert result["units_skipped"] == 1
    assert result["units_processed"] == 1
    kwargs = backfill_module.sync_publications.call_args.kwargs
    assert kwargs["date_from"] == date(2026, 1, 2)
    assert kwargs["date_to"] == date(2026, 1, 2)
    assert kwargs["modalities"] == [3]
    assert kwargs["client"] is fake_client
    # A caller-supplied client is not closed by backfill().
    fake_client.close.assert_not_called()


def test_backfill_rerun_with_all_units_done_makes_no_publication_calls():
    conn, _cursor = _mock_conn({"backfill:3:2026-01-01", "backfill:3:2026-01-02"})

    result = backfill_module.backfill(
        conn,
        since=date(2026, 1, 1),
        until=date(2026, 1, 2),
        modalities=[3],
        chunk_days=1,
        client=MagicMock(),
    )

    assert result["units_skipped"] == 2
    assert result["units_processed"] == 0
    backfill_module.sync_publications.assert_not_called()


def test_backfill_marks_processed_units_done_in_sync_state():
    conn, cursor = _mock_conn(set())

    backfill_module.backfill(
        conn,
        since=date(2026, 1, 1),
        until=date(2026, 1, 1),
        modalities=[3],
        chunk_days=7,
        client=MagicMock(),
    )

    insert_calls = [
        c for c in cursor.execute.call_args_list if "INSERT INTO sync_state" in c.args[0]
    ]
    assert len(insert_calls) == 1
    params = insert_calls[0].args[1]
    assert params["key"] == "backfill:3:2026-01-01"
    assert params["value"].obj["status"] == "done"
    assert params["value"].obj["total_records"] == 5
    assert "finished_at" in params["value"].obj


def test_backfill_opens_and_closes_an_agent_run():
    conn, cursor = _mock_conn(set())

    backfill_module.backfill(
        conn,
        since=date(2026, 1, 1),
        until=date(2026, 1, 1),
        modalities=[3],
        chunk_days=7,
        client=MagicMock(),
    )

    sqls = [c.args[0] for c in cursor.execute.call_args_list]
    assert any("INSERT INTO agent_runs" in sql for sql in sqls)
    assert any("UPDATE agent_runs SET status = 'done'" in sql for sql in sqls)
    kind = cursor.execute.call_args_list[1].args[1][0]
    assert kind == "backfill"


def test_backfill_loops_sync_details_until_zero_processed(monkeypatch):
    conn, _cursor = _mock_conn(set())
    sync_details_mock = MagicMock(side_effect=[100, 40, 0])
    monkeypatch.setattr(backfill_module, "sync_details", sync_details_mock)

    result = backfill_module.backfill(
        conn,
        since=date(2026, 1, 1),
        until=date(2026, 1, 1),
        modalities=[3],
        chunk_days=7,
        details_batch_size=100,
        max_details=None,  # unbounded drain
        client=MagicMock(),
    )

    assert sync_details_mock.call_count == 3
    assert result["details_processed"] == 140


def test_backfill_details_drain_is_bounded_by_max_details(monkeypatch):
    conn, _cursor = _mock_conn(set())
    sync_details_mock = MagicMock(side_effect=[100, 100, 100])
    monkeypatch.setattr(backfill_module, "sync_details", sync_details_mock)

    result = backfill_module.backfill(
        conn,
        since=date(2026, 1, 1),
        until=date(2026, 1, 1),
        modalities=[3],
        chunk_days=7,
        details_batch_size=100,
        max_details=200,
        client=MagicMock(),
    )

    assert sync_details_mock.call_count == 2
    assert result["details_processed"] == 200


def test_backfill_failed_unit_is_skipped_not_fatal(monkeypatch):
    conn, cursor = _mock_conn(set())
    sync_publications_mock = MagicMock(side_effect=[PncpApiError("boom"), {3: 5}])
    monkeypatch.setattr(backfill_module, "sync_publications", sync_publications_mock)

    result = backfill_module.backfill(
        conn,
        since=date(2026, 1, 1),
        until=date(2026, 1, 2),
        modalities=[3],
        chunk_days=1,
        client=MagicMock(),
    )

    assert result["units_failed"] == ["backfill:3:2026-01-01"]
    assert result["units_processed"] == 1
    assert sync_publications_mock.call_count == 2
    conn.rollback.assert_called_once()
    stamped_keys = [
        c.args[1]["key"]
        for c in cursor.execute.call_args_list
        if "INSERT INTO sync_state" in c.args[0]
    ]
    assert stamped_keys == ["backfill:3:2026-01-02"]


def test_backfill_owns_and_closes_the_client_when_none_injected(monkeypatch):
    conn, _cursor = _mock_conn(set())
    fake_client = MagicMock()
    monkeypatch.setattr(backfill_module, "PncpClient", MagicMock(return_value=fake_client))

    backfill_module.backfill(
        conn, since=date(2026, 1, 1), until=date(2026, 1, 1), modalities=[3], chunk_days=7
    )

    fake_client.close.assert_called_once()


# --- CLI: --days ------------------------------------------------------------


def _cli_app():
    import typer

    app = typer.Typer()
    cli_backfill_module.register(app)
    return app


def test_cli_backfill_days_computes_since_from_until(monkeypatch):
    monkeypatch.setattr(cli_backfill_module.db, "get_connection", MagicMock())
    run_backfill_mock = MagicMock(
        return_value={
            "units_total": 0,
            "units_processed": 0,
            "units_skipped": 0,
            "units_failed": [],
            "details_processed": 0,
        }
    )
    monkeypatch.setattr(cli_backfill_module, "run_backfill", run_backfill_mock)

    result = runner.invoke(_cli_app(), ["--days", "45", "--until", "2026-08-27"])

    assert result.exit_code == 0, result.output
    kwargs = run_backfill_mock.call_args.kwargs
    assert kwargs["since"] == date(2026, 7, 13)
    assert kwargs["until"] == date(2026, 8, 27)


def test_cli_backfill_days_computes_since_from_today_when_until_absent(monkeypatch):
    monkeypatch.setattr(cli_backfill_module.db, "get_connection", MagicMock())
    run_backfill_mock = MagicMock(
        return_value={
            "units_total": 0,
            "units_processed": 0,
            "units_skipped": 0,
            "units_failed": [],
            "details_processed": 0,
        }
    )
    monkeypatch.setattr(cli_backfill_module, "run_backfill", run_backfill_mock)

    result = runner.invoke(_cli_app(), ["--days", "10"])

    assert result.exit_code == 0, result.output
    kwargs = run_backfill_mock.call_args.kwargs
    assert kwargs["since"] is not None
    assert kwargs["until"] is None
