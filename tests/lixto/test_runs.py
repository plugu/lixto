"""Unit tests for the `agent_runs` context manager (src/lixto/runs.py).

Mocked psycopg connection: the assertions are about which SQL/params the
context manager writes on the done and failed paths.
"""

from unittest.mock import MagicMock

import pytest

from lixto.runs import RunCounters, run


def _mock_connection(run_id=42):
    cursor = MagicMock()
    cursor.fetchone.return_value = (run_id,)

    conn = MagicMock()
    conn.cursor.return_value.__enter__.return_value = cursor
    conn.cursor.return_value.__exit__.return_value = False
    return conn, cursor


def _calls(cursor):
    return [
        (call.args[0], call.args[1] if len(call.args) > 1 else ())
        for call in cursor.execute.call_args_list
    ]


def test_counters_inc_and_dict_access():
    counters = RunCounters()

    assert counters.inc("procurements") == 1
    counters.inc("procurements", 4)
    counters.inc("items", 3)

    assert counters["procurements"] == 5
    assert counters.get("missing") == 0
    assert "items" in counters
    assert counters.as_dict() == {"procurements": 5, "items": 3}
    assert sorted(counters) == ["items", "procurements"]


def test_run_inserts_running_row_and_marks_done_with_counters():
    conn, cursor = _mock_connection(run_id=7)

    with run(conn, "sync.procurements", company_id=3) as counters:
        counters.inc("pages", 2)

    insert_sql, insert_params = _calls(cursor)[0]
    assert "INSERT INTO agent_runs" in insert_sql
    assert "'running'" in insert_sql
    assert insert_params == ("sync.procurements", 3)

    update_sql, update_params = _calls(cursor)[-1]
    assert "status = 'done'" in update_sql
    assert "finished_at = now()" in update_sql
    assert update_params[0].obj == {"pages": 2}  # psycopg Json wrapper
    assert update_params[1] == 7
    assert conn.commit.call_count == 2


def test_run_marks_failed_with_error_and_reraises():
    conn, cursor = _mock_connection()

    with pytest.raises(ValueError, match="boom"), run(conn, "enrich") as counters:
        counters.inc("enriched")
        raise ValueError("boom")

    update_sql, update_params = _calls(cursor)[-1]
    assert "status = 'failed'" in update_sql
    assert update_params[0].obj == {"enriched": 1}
    assert update_params[1] == "boom"
    conn.rollback.assert_called_once()


def test_run_truncates_long_error_messages():
    conn, cursor = _mock_connection()

    with pytest.raises(RuntimeError), run(conn, "chat"):
        raise RuntimeError("x" * 5000)

    _, update_params = _calls(cursor)[-1]
    assert len(update_params[1]) == 2000


def test_run_without_company_id_passes_null():
    conn, cursor = _mock_connection()

    with run(conn, "match"):
        pass

    _, insert_params = _calls(cursor)[0]
    assert insert_params == ("match", None)
