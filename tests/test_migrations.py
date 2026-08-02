"""Unit tests for the migration runner (src/plic/db.py).

No live database required: uses mocked psycopg connections/cursors so this
suite runs before `docker compose up` in the ticket's check sequence.
"""

from unittest.mock import MagicMock

from plic import db


def _write_sql(path, name, content="SELECT 1;"):
    filepath = path / name
    filepath.write_text(content)
    return filepath


def test_list_migration_files_sorted_by_filename(tmp_path):
    # Create out of order to prove sorting, not creation-time ordering, wins.
    _write_sql(tmp_path, "003_third.sql")
    _write_sql(tmp_path, "001_first.sql")
    _write_sql(tmp_path, "002_second.sql")

    files = db.list_migration_files(tmp_path)

    assert [f.name for f in files] == [
        "001_first.sql",
        "002_second.sql",
        "003_third.sql",
    ]


def test_list_migration_files_missing_dir_returns_empty(tmp_path):
    missing = tmp_path / "does_not_exist"
    assert db.list_migration_files(missing) == []


def _mock_connection(applied_filenames):
    """Build a MagicMock psycopg.Connection whose cursor supports the
    `with conn.cursor() as cur:` pattern used by run_migrations, and whose
    SELECT filename query returns the given already-applied rows."""
    cursor = MagicMock()
    cursor.fetchall.return_value = [(name,) for name in applied_filenames]

    conn = MagicMock()
    conn.cursor.return_value.__enter__.return_value = cursor
    conn.cursor.return_value.__exit__.return_value = False
    return conn, cursor


def test_run_migrations_applies_pending_in_order(tmp_path):
    _write_sql(tmp_path, "001_first.sql", "CREATE TABLE a();")
    _write_sql(tmp_path, "002_second.sql", "CREATE TABLE b();")

    conn, cursor = _mock_connection(applied_filenames=[])

    applied = db.run_migrations(conn, migrations_dir=tmp_path)

    assert applied == ["001_first.sql", "002_second.sql"]

    # Two migration SQL executions plus two schema_migrations inserts plus
    # the ensure-table call: order of executed SQL statements matters.
    executed_sql = [call.args[0] for call in cursor.execute.call_args_list]
    assert "CREATE TABLE a();" in executed_sql
    assert "CREATE TABLE b();" in executed_sql
    assert executed_sql.index("CREATE TABLE a();") < executed_sql.index(
        "CREATE TABLE b();"
    )
    assert conn.commit.call_count >= 2


def test_run_migrations_skips_already_applied(tmp_path):
    _write_sql(tmp_path, "001_first.sql", "CREATE TABLE a();")
    _write_sql(tmp_path, "002_second.sql", "CREATE TABLE b();")

    conn, cursor = _mock_connection(applied_filenames=["001_first.sql"])

    applied = db.run_migrations(conn, migrations_dir=tmp_path)

    assert applied == ["002_second.sql"]

    executed_sql = [call.args[0] for call in cursor.execute.call_args_list]
    assert "CREATE TABLE a();" not in executed_sql
    assert "CREATE TABLE b();" in executed_sql


def test_run_migrations_noop_when_all_applied(tmp_path):
    _write_sql(tmp_path, "001_first.sql", "CREATE TABLE a();")

    conn, cursor = _mock_connection(applied_filenames=["001_first.sql"])

    applied = db.run_migrations(conn, migrations_dir=tmp_path)

    assert applied == []
    executed_sql = [call.args[0] for call in cursor.execute.call_args_list]
    assert "CREATE TABLE a();" not in executed_sql
