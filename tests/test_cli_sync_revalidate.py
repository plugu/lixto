"""Unit tests for the cache-revalidate call in `lixto sync incremental`
(src/lixto/cli/sync.py) — ticket 176.

`run_sync_incremental` and `db.get_connection` are stubbed so no database or
PNCP call happens; `InternalApi` is stubbed the same way as
tests/test_cli_match_recommend.py so these tests only exercise CLI wiring:
the cache revalidate call always fires and never changes the exit code.
"""

from __future__ import annotations

import httpx
from typer.testing import CliRunner

import lixto.cli.sync as sync_module
from lixto.cli import app

runner = CliRunner()


def _success_result(modalities_failed=None):
    return {
        "modalities_advanced": 3,
        "modalities_total": 3,
        "modalities_failed": modalities_failed or [],
        "rows_seen": 10,
        "details_processed": 5,
    }


class _StubConnection:
    def close(self) -> None:
        pass


def _make_internal_api_stub(exc=None):
    """Build a fake InternalApi class recording constructor/call args."""
    calls: dict = {"init": None, "cache_revalidate_called": 0}

    class _Stub:
        def __init__(self, base_url, token, timeout=600):
            calls["init"] = {"base_url": base_url, "token": token}

        def __enter__(self):
            return self

        def __exit__(self, *exc_info):
            return False

        def cache_revalidate(self, *, tags=None):
            calls["cache_revalidate_called"] += 1
            if exc is not None:
                raise exc
            return {"revalidated": ["sync"], "dropped": 1}

    return _Stub, calls


def _env(monkeypatch):
    monkeypatch.setenv("LIXTO_INTERNAL_TOKEN", "secret-token")
    monkeypatch.setenv("LIXTO_WEB_INTERNAL_URL", "http://web.internal")


def test_success_calls_cache_revalidate_once_and_exits_0(monkeypatch):
    _env(monkeypatch)
    monkeypatch.setattr(sync_module.db, "get_connection", lambda: _StubConnection())
    monkeypatch.setattr(
        sync_module, "run_sync_incremental", lambda conn, **kwargs: _success_result()
    )
    stub, calls = _make_internal_api_stub()
    monkeypatch.setattr(sync_module, "InternalApi", stub)

    result = runner.invoke(app, ["sync", "incremental"])

    assert result.exit_code == 0
    assert calls["cache_revalidate_called"] == 1
    assert "cache: revalidated sync" in result.output


def test_modalities_failed_still_calls_cache_revalidate_and_exits_1(monkeypatch):
    _env(monkeypatch)
    monkeypatch.setattr(sync_module.db, "get_connection", lambda: _StubConnection())
    monkeypatch.setattr(
        sync_module,
        "run_sync_incremental",
        lambda conn, **kwargs: _success_result(modalities_failed=[8]),
    )
    stub, calls = _make_internal_api_stub()
    monkeypatch.setattr(sync_module, "InternalApi", stub)

    result = runner.invoke(app, ["sync", "incremental"])

    assert result.exit_code == 1
    assert calls["cache_revalidate_called"] == 1
    assert "cache: revalidated sync" in result.output


def test_revalidate_failure_warns_but_does_not_change_exit_code(monkeypatch):
    _env(monkeypatch)
    monkeypatch.setattr(sync_module.db, "get_connection", lambda: _StubConnection())
    monkeypatch.setattr(
        sync_module, "run_sync_incremental", lambda conn, **kwargs: _success_result()
    )
    stub, calls = _make_internal_api_stub(exc=RuntimeError("LIXTO_INTERNAL_TOKEN is not set"))
    monkeypatch.setattr(sync_module, "InternalApi", stub)

    result = runner.invoke(app, ["sync", "incremental"])

    assert result.exit_code == 0
    assert calls["cache_revalidate_called"] == 1
    assert "warning: cache revalidate failed:" in result.output
    assert "LIXTO_INTERNAL_TOKEN is not set" in result.output


def test_revalidate_http_error_warns_but_does_not_change_exit_code(monkeypatch):
    _env(monkeypatch)
    monkeypatch.setattr(sync_module.db, "get_connection", lambda: _StubConnection())
    monkeypatch.setattr(
        sync_module,
        "run_sync_incremental",
        lambda conn, **kwargs: _success_result(modalities_failed=[8]),
    )
    stub, calls = _make_internal_api_stub(exc=httpx.ConnectError("connection refused"))
    monkeypatch.setattr(sync_module, "InternalApi", stub)

    result = runner.invoke(app, ["sync", "incremental"])

    assert result.exit_code == 1
    assert calls["cache_revalidate_called"] == 1
    assert "warning: cache revalidate failed:" in result.output
