"""Unit tests for `lixto email worker` / `lixto email digest`
(src/lixto/cli/email.py) — thin CLI triggers for the web app's
`/api/internal/email/*` batch endpoints (ticket 113).

`InternalApi` (network-facing, tested against httpx.MockTransport in
tests/test_internal_api.py) is stubbed here so these tests only exercise CLI
wiring: option parsing, output formatting and error handling.
"""

from __future__ import annotations

import httpx
import pytest
from typer.testing import CliRunner

import lixto.cli.email as email_module
from lixto.cli import app
from lixto.internal_api import InternalApiError

runner = CliRunner()


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv("LIXTO_INTERNAL_TOKEN", "secret-token")
    monkeypatch.setenv("LIXTO_WEB_INTERNAL_URL", "http://web.internal")


def _make_stub(result=None, exc=None):
    """Build a fake InternalApi class recording constructor/call args."""
    calls: dict = {"init": None, "email_send": None, "email_digest": None}

    class _Stub:
        def __init__(self, base_url, token, timeout=600):
            calls["init"] = {"base_url": base_url, "token": token}

        def __enter__(self):
            return self

        def __exit__(self, *exc_info):
            return False

        def email_send(self, *, limit=None):
            calls["email_send"] = {"limit": limit}
            if exc is not None:
                raise exc
            return result

        def email_digest(self, *, company_id=None):
            calls["email_digest"] = {"company_id": company_id}
            if exc is not None:
                raise exc
            return result

    return _Stub, calls


# ---------------------------------------------------------------- email worker


def test_email_worker_prints_counters(monkeypatch):
    stub, calls = _make_stub(result={"claimed": 5, "sent": 4, "failed": 1, "suppressed": 0})
    monkeypatch.setattr(email_module, "InternalApi", stub)

    result = runner.invoke(app, ["email", "worker"])

    assert result.exit_code == 0
    assert calls["init"] == {"base_url": "http://web.internal", "token": "secret-token"}
    assert calls["email_send"] == {"limit": 20}
    assert "claimed: 5" in result.output
    assert "sent: 4" in result.output
    assert "failed: 1" in result.output
    assert "suppressed: 0" in result.output


def test_email_worker_passes_limit(monkeypatch):
    stub, calls = _make_stub(result={"claimed": 1, "sent": 1, "failed": 0, "suppressed": 0})
    monkeypatch.setattr(email_module, "InternalApi", stub)

    result = runner.invoke(app, ["email", "worker", "--limit", "5"])

    assert result.exit_code == 0
    assert calls["email_send"] == {"limit": 5}


def test_email_worker_error_exits_1_without_traceback(monkeypatch):
    stub, _calls = _make_stub(exc=InternalApiError(401, "unauthorized"))
    monkeypatch.setattr(email_module, "InternalApi", stub)

    result = runner.invoke(app, ["email", "worker"])

    assert result.exit_code == 1
    assert "401" in result.output
    assert "Traceback" not in result.output


def test_email_worker_connection_error_exits_1(monkeypatch):
    stub, _calls = _make_stub(exc=httpx.ConnectError("connection refused"))
    monkeypatch.setattr(email_module, "InternalApi", stub)

    result = runner.invoke(app, ["email", "worker"])

    assert result.exit_code == 1
    assert "connection refused" in result.output
    assert "Traceback" not in result.output


def test_email_worker_help_lists_limit_option():
    result = runner.invoke(app, ["email", "worker", "--help"])

    assert result.exit_code == 0
    assert "--limit" in result.output


# ---------------------------------------------------------------- email digest


def test_email_digest_prints_counters(monkeypatch):
    stub, calls = _make_stub(result={"companies": 3, "enqueued": 4, "skipped": 1})
    monkeypatch.setattr(email_module, "InternalApi", stub)

    result = runner.invoke(app, ["email", "digest"])

    assert result.exit_code == 0
    assert calls["email_digest"] == {"company_id": None}
    assert "companies: 3" in result.output
    assert "enqueued: 4" in result.output
    assert "skipped: 1" in result.output


def test_email_digest_passes_company_id(monkeypatch):
    stub, calls = _make_stub(result={"companies": 1, "enqueued": 2, "skipped": 0})
    monkeypatch.setattr(email_module, "InternalApi", stub)

    result = runner.invoke(app, ["email", "digest", "--company-id", "42"])

    assert result.exit_code == 0
    assert calls["email_digest"] == {"company_id": 42}


def test_email_digest_error_exits_1_without_traceback(monkeypatch):
    stub, _calls = _make_stub(exc=InternalApiError(500, '{"error": "boom"}'))
    monkeypatch.setattr(email_module, "InternalApi", stub)

    result = runner.invoke(app, ["email", "digest"])

    assert result.exit_code == 1
    assert "500" in result.output
    assert "Traceback" not in result.output


def test_email_digest_help_lists_company_id_option():
    result = runner.invoke(app, ["email", "digest", "--help"])

    assert result.exit_code == 0
    assert "--company-id" in result.output
