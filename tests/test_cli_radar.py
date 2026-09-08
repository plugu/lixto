"""Unit tests for `lixto radar run` (src/lixto/cli/radar.py) — a thin CLI
trigger for the web app's `/api/internal/radar/run` batch endpoint (ticket
124/125), mirroring tests/test_cli_match_recommend.py.

`InternalApi` (network-facing, tested against httpx.MockTransport in
tests/test_internal_api.py) is stubbed here so these tests only exercise CLI
wiring: option parsing, output formatting and error handling.
"""

from __future__ import annotations

import httpx
import pytest
from typer.testing import CliRunner

import lixto.cli.radar as radar_module
from lixto.cli import app
from lixto.internal_api import InternalApiError

runner = CliRunner()


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv("LIXTO_INTERNAL_TOKEN", "secret-token")
    monkeypatch.setenv("LIXTO_WEB_INTERNAL_URL", "http://web.internal")


def _make_stub(result=None, exc=None):
    """Build a fake InternalApi class recording constructor/call args."""
    calls: dict = {"init": None, "radar_run": None}

    class _Stub:
        def __init__(self, base_url, token, timeout=600):
            calls["init"] = {"base_url": base_url, "token": token}

        def __enter__(self):
            return self

        def __exit__(self, *exc_info):
            return False

        def radar_run(self, *, company_id=None):
            calls["radar_run"] = {"company_id": company_id}
            if exc is not None:
                raise exc
            return result

    return _Stub, calls


def test_radar_run_prints_counters(monkeypatch):
    stub, calls = _make_stub(result={"runId": 1, "companies": 3, "opportunities": 10, "matched": 4})
    monkeypatch.setattr(radar_module, "InternalApi", stub)

    result = runner.invoke(app, ["radar", "run"])

    assert result.exit_code == 0
    assert calls["init"] == {"base_url": "http://web.internal", "token": "secret-token"}
    assert calls["radar_run"] == {"company_id": None}
    assert "runId: 1" in result.output
    assert "companies: 3" in result.output
    assert "opportunities: 10" in result.output
    assert "matched: 4" in result.output


def test_radar_run_prints_none_for_keys_not_yet_returned(monkeypatch):
    """Ticket 124 today only returns runId/opportunities/expired; companies
    and matched arrive in ticket 126. Missing keys must print `None`, not
    raise, exactly as cli/match.py does."""
    stub, _calls = _make_stub(result={"runId": 2, "opportunities": 7, "expired": 1})
    monkeypatch.setattr(radar_module, "InternalApi", stub)

    result = runner.invoke(app, ["radar", "run"])

    assert result.exit_code == 0
    assert "runId: 2" in result.output
    assert "companies: None" in result.output
    assert "opportunities: 7" in result.output
    assert "matched: None" in result.output


def test_radar_run_passes_company_id(monkeypatch):
    stub, calls = _make_stub(result={"runId": 3, "companies": 1, "opportunities": 5, "matched": 2})
    monkeypatch.setattr(radar_module, "InternalApi", stub)

    result = runner.invoke(app, ["radar", "run", "--company-id", "42"])

    assert result.exit_code == 0
    assert calls["radar_run"] == {"company_id": 42}


def test_radar_run_error_exits_1_without_traceback(monkeypatch):
    stub, _calls = _make_stub(exc=InternalApiError(401, "unauthorized"))
    monkeypatch.setattr(radar_module, "InternalApi", stub)

    result = runner.invoke(app, ["radar", "run"])

    assert result.exit_code == 1
    assert "401" in result.output
    assert "Traceback" not in result.output


def test_radar_run_connection_error_exits_1(monkeypatch):
    stub, _calls = _make_stub(exc=httpx.ConnectError("connection refused"))
    monkeypatch.setattr(radar_module, "InternalApi", stub)

    result = runner.invoke(app, ["radar", "run"])

    assert result.exit_code == 1
    assert "connection refused" in result.output
    assert "Traceback" not in result.output


def test_radar_run_missing_token_exits_1(monkeypatch):
    monkeypatch.delenv("LIXTO_INTERNAL_TOKEN", raising=False)

    result = runner.invoke(app, ["radar", "run"])

    assert result.exit_code == 1
    assert "LIXTO_INTERNAL_TOKEN" in result.output


def test_radar_run_help_lists_company_id_option():
    result = runner.invoke(app, ["radar", "run", "--help"])

    assert result.exit_code == 0
    assert "--company-id" in result.output
