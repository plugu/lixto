"""Unit tests for `lixto cases run` (src/lixto/cli/cases.py) — the thin CLI
trigger for the web app's `/api/internal/cases/run` batch endpoint
(ticket 168).

`InternalApi` (network-facing, tested against httpx.MockTransport in
tests/test_internal_api.py) is stubbed here so these tests only exercise CLI
wiring: option parsing, output formatting and error handling.
"""

from __future__ import annotations

import httpx
import pytest
from typer.testing import CliRunner

import lixto.cli.cases as cases_module
from lixto.cli import app
from lixto.internal_api import InternalApiError

runner = CliRunner()

COUNTERS = {
    "runId": 12,
    "created": 3,
    "ready": 2,
    "waiting": 1,
    "emailed": 0,
    "resultsRequested": 0,
    "resolved": 0,
    "failed": 0,
}


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv("LIXTO_INTERNAL_TOKEN", "secret-token")
    monkeypatch.setenv("LIXTO_WEB_INTERNAL_URL", "http://web.internal")


def _make_stub(result=None, exc=None):
    """Build a fake InternalApi class recording constructor/call args."""
    calls: dict = {"init": None, "cases_run": None}

    class _Stub:
        def __init__(self, base_url, token, timeout=600):
            calls["init"] = {"base_url": base_url, "token": token}

        def __enter__(self):
            return self

        def __exit__(self, *exc_info):
            return False

        def cases_run(self, *, company_id=None):
            calls["cases_run"] = {"company_id": company_id}
            if exc is not None:
                raise exc
            return result

    return _Stub, calls


def test_cases_run_prints_counters(monkeypatch):
    stub, calls = _make_stub(result=COUNTERS)
    monkeypatch.setattr(cases_module, "InternalApi", stub)

    result = runner.invoke(app, ["cases", "run"])

    assert result.exit_code == 0
    assert calls["init"] == {"base_url": "http://web.internal", "token": "secret-token"}
    assert calls["cases_run"] == {"company_id": None}
    assert "runId: 12" in result.output
    assert "created: 3" in result.output
    assert "ready: 2" in result.output
    assert "waiting: 1" in result.output
    assert "emailed: 0" in result.output
    assert "resultsRequested: 0" in result.output
    assert "resolved: 0" in result.output
    assert "failed: 0" in result.output


def test_cases_run_passes_company_id(monkeypatch):
    stub, calls = _make_stub(result=COUNTERS)
    monkeypatch.setattr(cases_module, "InternalApi", stub)

    result = runner.invoke(app, ["cases", "run", "--company-id", "7"])

    assert result.exit_code == 0
    assert calls["cases_run"] == {"company_id": 7}


def test_cases_run_error_exits_1_without_traceback(monkeypatch):
    stub, _calls = _make_stub(exc=InternalApiError(500, '{"error": "falha ao rodar os casos"}'))
    monkeypatch.setattr(cases_module, "InternalApi", stub)

    result = runner.invoke(app, ["cases", "run"])

    assert result.exit_code == 1
    assert "error:" in result.output
    assert "500" in result.output
    assert "Traceback" not in result.output


def test_cases_run_connection_error_exits_1(monkeypatch):
    stub, _calls = _make_stub(exc=httpx.ConnectError("connection refused"))
    monkeypatch.setattr(cases_module, "InternalApi", stub)

    result = runner.invoke(app, ["cases", "run"])

    assert result.exit_code == 1
    assert "error:" in result.output
    assert "connection refused" in result.output
    assert "Traceback" not in result.output


def test_cases_run_help_lists_company_id_option():
    result = runner.invoke(app, ["cases", "run", "--help"])

    assert result.exit_code == 0
    assert "--company-id" in result.output
