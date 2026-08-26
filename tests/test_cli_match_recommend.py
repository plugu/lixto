"""Unit tests for `lixto match run` / `lixto recommend run`
(src/lixto/cli/match.py, src/lixto/cli/recommend.py) — thin CLI triggers for
the web app's `/api/internal/*` batch endpoints (tickets 90/91).

`InternalApi` (network-facing, tested against httpx.MockTransport in
tests/test_internal_api.py) is stubbed here so these tests only exercise CLI
wiring: option parsing, output formatting and error handling.
"""

from __future__ import annotations

import httpx
import pytest
from typer.testing import CliRunner

import lixto.cli.match as match_module
import lixto.cli.recommend as recommend_module
from lixto.cli import app
from lixto.internal_api import InternalApiError

runner = CliRunner()


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv("LIXTO_INTERNAL_TOKEN", "secret-token")
    monkeypatch.setenv("LIXTO_WEB_INTERNAL_URL", "http://web.internal")


def _make_stub(result=None, exc=None):
    """Build a fake InternalApi class recording constructor/call args."""
    calls: dict = {"init": None, "match_run": None, "recommend_run": None}

    class _Stub:
        def __init__(self, base_url, token, timeout=600):
            calls["init"] = {"base_url": base_url, "token": token}

        def __enter__(self):
            return self

        def __exit__(self, *exc_info):
            return False

        def match_run(self, *, company_id=None, since=None):
            calls["match_run"] = {"company_id": company_id, "since": since}
            if exc is not None:
                raise exc
            return result

        def recommend_run(self, *, company_id=None, limit=None):
            calls["recommend_run"] = {"company_id": company_id, "limit": limit}
            if exc is not None:
                raise exc
            return result

    return _Stub, calls


# ------------------------------------------------------------------ match run


def test_match_run_prints_counters(monkeypatch):
    stub, calls = _make_stub(
        result={"runId": 1, "companies": 3, "scored": 10, "matched": 4, "attention": 1}
    )
    monkeypatch.setattr(match_module, "InternalApi", stub)

    result = runner.invoke(app, ["match", "run"])

    assert result.exit_code == 0
    assert calls["init"] == {"base_url": "http://web.internal", "token": "secret-token"}
    assert calls["match_run"] == {"company_id": None, "since": None}
    assert "runId: 1" in result.output
    assert "companies: 3" in result.output
    assert "scored: 10" in result.output
    assert "matched: 4" in result.output
    assert "attention: 1" in result.output


def test_match_run_passes_company_id_and_since(monkeypatch):
    stub, calls = _make_stub(
        result={"runId": 2, "companies": 1, "scored": 5, "matched": 2, "attention": 0}
    )
    monkeypatch.setattr(match_module, "InternalApi", stub)

    result = runner.invoke(app, ["match", "run", "--company-id", "42", "--since", "2026-08-01"])

    assert result.exit_code == 0
    assert calls["match_run"] == {"company_id": 42, "since": "2026-08-01"}


def test_match_run_error_exits_1_without_traceback(monkeypatch):
    stub, _calls = _make_stub(exc=InternalApiError(401, "unauthorized"))
    monkeypatch.setattr(match_module, "InternalApi", stub)

    result = runner.invoke(app, ["match", "run"])

    assert result.exit_code == 1
    assert "401" in result.output
    assert "Traceback" not in result.output


def test_match_run_connection_error_exits_1(monkeypatch):
    stub, _calls = _make_stub(exc=httpx.ConnectError("connection refused"))
    monkeypatch.setattr(match_module, "InternalApi", stub)

    result = runner.invoke(app, ["match", "run"])

    assert result.exit_code == 1
    assert "connection refused" in result.output
    assert "Traceback" not in result.output


def test_match_run_help_lists_since_option():
    result = runner.invoke(app, ["match", "run", "--help"])

    assert result.exit_code == 0
    assert "--since" in result.output


# -------------------------------------------------------------- recommend run


def test_recommend_run_prints_counters(monkeypatch):
    stub, calls = _make_stub(
        result={"runId": 3, "companies": 2, "recommended": 5, "skipped_cap": 1, "failed": 0}
    )
    monkeypatch.setattr(recommend_module, "InternalApi", stub)

    result = runner.invoke(app, ["recommend", "run"])

    assert result.exit_code == 0
    assert calls["recommend_run"] == {"company_id": None, "limit": None}
    assert "runId: 3" in result.output
    assert "recommended: 5" in result.output
    assert "skipped_cap: 1" in result.output
    assert "failed: 0" in result.output


def test_recommend_run_passes_company_id_and_limit(monkeypatch):
    stub, calls = _make_stub(
        result={"runId": 4, "companies": 1, "recommended": 5, "skipped_cap": 0, "failed": 0}
    )
    monkeypatch.setattr(recommend_module, "InternalApi", stub)

    result = runner.invoke(app, ["recommend", "run", "--company-id", "9", "--limit", "5"])

    assert result.exit_code == 0
    assert calls["recommend_run"] == {"company_id": 9, "limit": 5}


def test_recommend_run_error_exits_1_without_traceback(monkeypatch):
    stub, _calls = _make_stub(exc=InternalApiError(500, '{"error": "boom"}'))
    monkeypatch.setattr(recommend_module, "InternalApi", stub)

    result = runner.invoke(app, ["recommend", "run"])

    assert result.exit_code == 1
    assert "500" in result.output
    assert "Traceback" not in result.output


def test_recommend_run_help_lists_limit_option():
    result = runner.invoke(app, ["recommend", "run", "--help"])

    assert result.exit_code == 0
    assert "--limit" in result.output
