"""Unit tests for `lixto users` commands (src/lixto/cli/users.py).

Tests exercise CLI wiring: email normalization, SQL parameters, output formatting,
and error handling. The database connection is stubbed so no database is needed.
"""

from __future__ import annotations

from typer.testing import CliRunner

import lixto.cli.users as users_module
from lixto.cli import app

runner = CliRunner()


def _make_stub_connection(rows_to_return=None, commit_ok=True):
    """Build a fake connection and cursor pair recording execute calls."""
    state = {
        "execute_calls": [],
        "commit_called": False,
        "close_called": False,
    }

    class _StubCursor:
        def __init__(self, conn):
            self.conn = conn

        def __enter__(self):
            return self

        def __exit__(self, *exc_info):
            return False

        def execute(self, sql, params=()):
            state["execute_calls"].append({"sql": sql, "params": params})

        def fetchone(self):
            return rows_to_return[0] if rows_to_return else None

        def fetchall(self):
            return rows_to_return or []

    class _StubConnection:
        def cursor(self):
            return _StubCursor(self)

        def commit(self):
            state["commit_called"] = True

        def close(self):
            state["close_called"] = True

    return _StubConnection(), state


# ================================================================ grant-superadmin


def test_grant_superadmin_success(monkeypatch):
    conn, state = _make_stub_connection(rows_to_return=[(123, "Alice")])
    monkeypatch.setattr(
        users_module.db,
        "get_connection",
        lambda: conn,
    )

    result = runner.invoke(app, ["users", "grant-superadmin", "alice@example.com"])

    assert result.exit_code == 0
    assert "granted: Alice alice@example.com" in result.output
    assert state["commit_called"]
    assert state["close_called"]
    assert len(state["execute_calls"]) == 1
    call = state["execute_calls"][0]
    assert "is_superadmin = true" in call["sql"]
    assert "WHERE email = %s" in call["sql"]
    assert call["params"] == ("alice@example.com",)


def test_grant_superadmin_normalizes_email(monkeypatch):
    conn, state = _make_stub_connection(rows_to_return=[(123, "Bob")])
    monkeypatch.setattr(
        users_module.db,
        "get_connection",
        lambda: conn,
    )

    result = runner.invoke(app, ["users", "grant-superadmin", "  Bob@EXAMPLE.COM  "])

    assert result.exit_code == 0
    call = state["execute_calls"][0]
    # Email should be lowercased and stripped
    assert call["params"] == ("bob@example.com",)
    assert "granted: Bob bob@example.com" in result.output


def test_grant_superadmin_no_user_exits_1(monkeypatch):
    conn, state = _make_stub_connection(rows_to_return=None)
    monkeypatch.setattr(
        users_module.db,
        "get_connection",
        lambda: conn,
    )

    result = runner.invoke(app, ["users", "grant-superadmin", "nobody@example.com"])

    assert result.exit_code == 1
    assert "error: no user with email nobody@example.com" in result.output
    assert state["close_called"]


# ================================================================ revoke-superadmin


def test_revoke_superadmin_success(monkeypatch):
    conn, state = _make_stub_connection(rows_to_return=[(456, "Charlie")])
    monkeypatch.setattr(
        users_module.db,
        "get_connection",
        lambda: conn,
    )

    result = runner.invoke(app, ["users", "revoke-superadmin", "charlie@example.com"])

    assert result.exit_code == 0
    assert "revoked: Charlie charlie@example.com" in result.output
    assert state["commit_called"]
    assert state["close_called"]
    assert len(state["execute_calls"]) == 1
    call = state["execute_calls"][0]
    assert "is_superadmin = false" in call["sql"]
    assert "WHERE email = %s" in call["sql"]
    assert call["params"] == ("charlie@example.com",)


def test_revoke_superadmin_normalizes_email(monkeypatch):
    conn, state = _make_stub_connection(rows_to_return=[(456, "Charlie")])
    monkeypatch.setattr(
        users_module.db,
        "get_connection",
        lambda: conn,
    )

    result = runner.invoke(app, ["users", "revoke-superadmin", "  Charlie@EXAMPLE.COM  "])

    assert result.exit_code == 0
    call = state["execute_calls"][0]
    # Email should be lowercased and stripped
    assert call["params"] == ("charlie@example.com",)


def test_revoke_superadmin_no_user_exits_1(monkeypatch):
    conn, state = _make_stub_connection(rows_to_return=None)
    monkeypatch.setattr(
        users_module.db,
        "get_connection",
        lambda: conn,
    )

    result = runner.invoke(app, ["users", "revoke-superadmin", "nobody@example.com"])

    assert result.exit_code == 1
    assert "error: no user with email nobody@example.com" in result.output
    assert state["close_called"]


# ================================================================ list-superadmins


def test_list_superadmins_shows_rows(monkeypatch):
    rows_to_return = [
        ("alice@example.com", "Alice", "Acme Inc"),
        ("bob@example.com", "Bob", "Tech Ltd"),
    ]
    conn, state = _make_stub_connection(rows_to_return=rows_to_return)
    monkeypatch.setattr(
        users_module.db,
        "get_connection",
        lambda: conn,
    )

    result = runner.invoke(app, ["users", "list-superadmins"])

    assert result.exit_code == 0
    assert "alice@example.com  Alice  Acme Inc" in result.output
    assert "bob@example.com  Bob  Tech Ltd" in result.output
    assert state["close_called"]
    assert len(state["execute_calls"]) == 1
    call = state["execute_calls"][0]
    assert "WHERE u.is_superadmin" in call["sql"]
    assert "ORDER BY u.email" in call["sql"]


def test_list_superadmins_empty_shows_none(monkeypatch):
    conn, state = _make_stub_connection(rows_to_return=[])
    monkeypatch.setattr(
        users_module.db,
        "get_connection",
        lambda: conn,
    )

    result = runner.invoke(app, ["users", "list-superadmins"])

    assert result.exit_code == 0
    assert "none" in result.output
    assert state["close_called"]


def test_users_group_has_all_commands():
    result = runner.invoke(app, ["users", "--help"])

    assert result.exit_code == 0
    assert "grant-superadmin" in result.output
    assert "revoke-superadmin" in result.output
    assert "list-superadmins" in result.output
