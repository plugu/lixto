"""Unit tests for `lixto cache revalidate` (src/lixto/cli/cache.py) — a thin
CLI trigger for the web app's `/api/internal/cache/revalidate` endpoint
(ticket 175).

`InternalApi` (network-facing, tested against httpx.MockTransport in
tests/test_internal_api.py) is stubbed here so these tests only exercise CLI
wiring: option parsing, output formatting and error handling.
"""

from __future__ import annotations

import httpx
import pytest
from typer.testing import CliRunner

import lixto.cli.cache as cache_module
from lixto.cli import app
from lixto.internal_api import InternalApiError

runner = CliRunner()


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv("LIXTO_INTERNAL_TOKEN", "secret-token")
    monkeypatch.setenv("LIXTO_WEB_INTERNAL_URL", "http://web.internal")


def _make_stub(result=None, exc=None):
    """Build a fake InternalApi class recording constructor/call args."""
    calls: dict = {"init": None, "cache_revalidate": None}

    class _Stub:
        def __init__(self, base_url, token, timeout=600):
            calls["init"] = {"base_url": base_url, "token": token}

        def __enter__(self):
            return self

        def __exit__(self, *exc_info):
            return False

        def cache_revalidate(self, *, tags=None):
            calls["cache_revalidate"] = {"tags": tags}
            if exc is not None:
                raise exc
            return result

    return _Stub, calls


def test_revalidate_prints_counters(monkeypatch):
    stub, calls = _make_stub(result={"revalidated": ["sync"], "dropped": 1})
    monkeypatch.setattr(cache_module, "InternalApi", stub)

    result = runner.invoke(app, ["cache", "revalidate"])

    assert result.exit_code == 0
    assert calls["init"] == {"base_url": "http://web.internal", "token": "secret-token"}
    assert calls["cache_revalidate"] == {"tags": None}
    assert "revalidated: ['sync']" in result.output
    assert "dropped: 1" in result.output


def test_revalidate_tag_repeat_passes_list(monkeypatch):
    stub, calls = _make_stub(result={"revalidated": ["sync", "match"], "dropped": 2})
    monkeypatch.setattr(cache_module, "InternalApi", stub)

    result = runner.invoke(app, ["cache", "revalidate", "--tag", "sync", "--tag", "match"])

    assert result.exit_code == 0
    assert calls["cache_revalidate"] == {"tags": ["sync", "match"]}


def test_revalidate_error_exits_1_without_traceback(monkeypatch):
    stub, _calls = _make_stub(exc=InternalApiError(400, '{"error": "tag inválida"}'))
    monkeypatch.setattr(cache_module, "InternalApi", stub)

    result = runner.invoke(app, ["cache", "revalidate", "--tag", "bogus"])

    assert result.exit_code == 1
    assert "400" in result.output
    assert "Traceback" not in result.output


def test_revalidate_connection_error_exits_1(monkeypatch):
    stub, _calls = _make_stub(exc=httpx.ConnectError("connection refused"))
    monkeypatch.setattr(cache_module, "InternalApi", stub)

    result = runner.invoke(app, ["cache", "revalidate"])

    assert result.exit_code == 1
    assert "connection refused" in result.output
    assert "Traceback" not in result.output


def test_revalidate_help_lists_tag_option():
    result = runner.invoke(app, ["cache", "revalidate", "--help"])

    assert result.exit_code == 0
    assert "--tag" in result.output
