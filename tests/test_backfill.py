"""Unit tests for src/plic/backfill.py.

No network, no live database: chunk generation is pure-function tested
directly; resume-skip / orchestration logic is tested with MagicMock
connections and monkeypatched sync_publicacao/sync_detalhes so nothing hits
psycopg or httpx for real.
"""

from datetime import date
from unittest.mock import MagicMock

import pytest

from plic import backfill as backfill_module
from plic.backfill import backfill_unit_key, generate_chunks
from plic.pncp_client import PncpApiError

# --- generate_chunks ----------------------------------------------------


def test_generate_chunks_splits_into_7_day_windows():
    chunks = generate_chunks(date(2026, 1, 1), date(2026, 1, 14))

    assert chunks == [
        (date(2026, 1, 1), date(2026, 1, 7)),
        (date(2026, 1, 8), date(2026, 1, 14)),
    ]


def test_generate_chunks_partial_last_chunk():
    chunks = generate_chunks(date(2026, 1, 1), date(2026, 1, 10))

    assert chunks == [
        (date(2026, 1, 1), date(2026, 1, 7)),
        (date(2026, 1, 8), date(2026, 1, 10)),
    ]


def test_generate_chunks_single_day_range():
    chunks = generate_chunks(date(2026, 1, 2), date(2026, 1, 2))

    assert chunks == [(date(2026, 1, 2), date(2026, 1, 2))]


def test_generate_chunks_since_after_until_returns_empty():
    assert generate_chunks(date(2026, 1, 10), date(2026, 1, 1)) == []


def test_generate_chunks_exact_multiple_of_chunk_days_has_no_trailing_short_chunk():
    chunks = generate_chunks(date(2026, 1, 1), date(2026, 1, 7))

    assert chunks == [(date(2026, 1, 1), date(2026, 1, 7))]


def test_generate_chunks_custom_chunk_days():
    chunks = generate_chunks(date(2026, 1, 1), date(2026, 1, 5), chunk_days=2)

    assert chunks == [
        (date(2026, 1, 1), date(2026, 1, 2)),
        (date(2026, 1, 3), date(2026, 1, 4)),
        (date(2026, 1, 5), date(2026, 1, 5)),
    ]


# --- backfill_unit_key ---------------------------------------------------


def test_backfill_unit_key_format():
    assert backfill_unit_key(3, date(2026, 1, 8)) == "backfill:3:2026-01-08"


# --- resume-skip / orchestration ----------------------------------------


def _mock_conn(done_keys: set[str]):
    cursor = MagicMock()
    cursor.fetchall.return_value = [(k,) for k in done_keys]

    conn = MagicMock()
    conn.cursor.return_value.__enter__.return_value = cursor
    conn.cursor.return_value.__exit__.return_value = False
    return conn, cursor


@pytest.fixture(autouse=True)
def _no_real_clients(monkeypatch):
    # backfill() constructs PncpClient() itself when none is injected, so
    # neither test should hit a real client — always inject fakes.
    monkeypatch.setattr(backfill_module, "sync_publicacao", MagicMock(return_value={3: 5}))
    monkeypatch.setattr(backfill_module, "sync_detalhes", MagicMock(return_value=0))


def test_backfill_skips_units_already_done(monkeypatch):
    # One modalidade, two chunks of 1 day each; first chunk already done.
    conn, _cursor = _mock_conn({"backfill:3:2026-01-01"})

    fake_publicacao_client = MagicMock()
    fake_detalhes_client = MagicMock()

    result = backfill_module.backfill(
        conn,
        since=date(2026, 1, 1),
        until=date(2026, 1, 2),
        modalidades=[3],
        chunk_days=1,
        publicacao_client=fake_publicacao_client,
        detalhes_client=fake_detalhes_client,
    )

    assert result["units_total"] == 2
    assert result["units_skipped"] == 1
    assert result["units_processed"] == 1
    backfill_module.sync_publicacao.assert_called_once_with(
        conn,
        data_inicial=date(2026, 1, 2),
        data_final=date(2026, 1, 2),
        modalidades=[3],
        client=fake_publicacao_client,
    )
    # Caller-supplied clients are not closed by backfill().
    fake_publicacao_client.close.assert_not_called()
    fake_detalhes_client.close.assert_not_called()


def test_backfill_rerun_with_all_units_done_skips_everything_and_makes_no_publicacao_calls():
    conn, _cursor = _mock_conn(
        {"backfill:3:2026-01-01", "backfill:3:2026-01-02"}
    )

    result = backfill_module.backfill(
        conn,
        since=date(2026, 1, 1),
        until=date(2026, 1, 2),
        modalidades=[3],
        chunk_days=1,
        publicacao_client=MagicMock(),
        detalhes_client=MagicMock(),
    )

    assert result["units_total"] == 2
    assert result["units_skipped"] == 2
    assert result["units_processed"] == 0
    backfill_module.sync_publicacao.assert_not_called()


def test_backfill_marks_processed_units_done_in_sync_state(monkeypatch):
    conn, cursor = _mock_conn(set())

    backfill_module.backfill(
        conn,
        since=date(2026, 1, 1),
        until=date(2026, 1, 1),
        modalidades=[3],
        chunk_days=7,
        publicacao_client=MagicMock(),
        detalhes_client=MagicMock(),
    )

    insert_calls = [
        c for c in cursor.execute.call_args_list if "INSERT INTO sync_state" in c.args[0]
    ]
    assert len(insert_calls) == 1
    params = insert_calls[0].args[1]
    assert params["key"] == "backfill:3:2026-01-01"
    assert params["value"].obj["status"] == "done"
    assert params["value"].obj["total_registros"] == 5
    assert "finished_at" in params["value"].obj


def test_backfill_loops_sync_detalhes_until_zero_processed(monkeypatch):
    conn, _cursor = _mock_conn(set())
    sync_detalhes_mock = MagicMock(side_effect=[500, 200, 0])
    monkeypatch.setattr(backfill_module, "sync_detalhes", sync_detalhes_mock)

    result = backfill_module.backfill(
        conn,
        since=date(2026, 1, 1),
        until=date(2026, 1, 1),
        modalidades=[3],
        chunk_days=7,
        detalhes_batch_size=500,
        publicacao_client=MagicMock(),
        detalhes_client=MagicMock(),
    )

    assert sync_detalhes_mock.call_count == 3
    assert result["detalhes_processed"] == 700


def test_backfill_propagates_pncp_api_errors_from_publicacao(monkeypatch):
    # Ticket 05 centralized HTTP-204-for-zero-results handling into the
    # client itself (sync_publicacao never sees it as an error anymore), so
    # backfill no longer special-cases any PncpApiError from sync_publicacao
    # — any error after retries propagates and fails the run.
    conn, _cursor = _mock_conn(set())
    sync_publicacao_mock = MagicMock(
        side_effect=PncpApiError("PNCP returned 500 for /v1/contratacoes/publicacao params={}")
    )
    monkeypatch.setattr(backfill_module, "sync_publicacao", sync_publicacao_mock)

    with pytest.raises(PncpApiError):
        backfill_module.backfill(
            conn,
            since=date(2026, 1, 1),
            until=date(2026, 1, 1),
            modalidades=[3],
            chunk_days=7,
            publicacao_client=MagicMock(),
            detalhes_client=MagicMock(),
        )


def test_backfill_owns_and_closes_clients_when_none_injected(monkeypatch):
    conn, _cursor = _mock_conn(set())

    fake_publicacao_client = MagicMock()
    fake_detalhes_client = MagicMock()
    client_ctor = MagicMock(side_effect=[fake_publicacao_client, fake_detalhes_client])
    monkeypatch.setattr(backfill_module, "PncpClient", client_ctor)

    backfill_module.backfill(
        conn,
        since=date(2026, 1, 1),
        until=date(2026, 1, 1),
        modalidades=[3],
        chunk_days=7,
    )

    fake_publicacao_client.close.assert_called_once()
    fake_detalhes_client.close.assert_called_once()
