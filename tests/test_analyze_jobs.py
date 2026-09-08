"""Unit tests for src/lixto/analyze/jobs.py and the `lixto analyze jobs` CLI.

Fully mocked psycopg connections/cursors and a mocked `analyze_one` — no
network, no live database.
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest
from typer.testing import CliRunner

import lixto.cli.analyze as analyze_cli
from lixto.analyze import jobs
from lixto.analyze.jobs import (
    _CLAIM_SQL,
    _FINISH_SQL,
    _SELECT_ROW_SQL,
    _STALE_REQUEUE_SQL,
    drain_jobs,
)
from lixto.cli import app

runner = CliRunner()


def _row(procurement_id=42):
    return {
        "id": procurement_id,
        "source_id": f"num-{procurement_id}",
        "description": "Aquisição de lápis grafite para escolas municipais",
        "additional_info": None,
        "modality_name": "Pregão Eletrônico",
        "state": "RJ",
        "city_name": "Rio de Janeiro",
        "estimated_value": 12345,
        "published_at": "2026-08-01",
        "proposal_opens_at": "2026-08-05",
        "proposal_closes_at": "2026-09-01",
        "is_price_registry": True,
        "agency_name": "Prefeitura do Rio",
    }


def _llm(usage=None):
    llm = MagicMock()
    llm.usage_summary.return_value = usage or {
        "calls": 0,
        "prompt_tokens": 0,
        "completion_tokens": 0,
        "est_usd_micros": 0,
        "unpriced_models": [],
    }
    return llm


def _conn(claims, rows=None, analysis_errors=None):
    """Builds a mocked connection whose `conn.cursor().__enter__()` yields
    one mock cursor per call, in the order `drain_jobs` opens them: stale
    requeue, then per job (claim, [fetch row], [fetch analysis error],
    finish).

    `claims`: list of claim results (tuple `(id, procurement_id)` or `None`
    to stop the loop) — one per claim, in order.
    `rows`: dict of procurement_id -> row (or `None`/missing for "not
    found"), consulted only when a claim succeeds.
    `analysis_errors`: dict of procurement_id -> persisted error text,
    consulted only when `analyze_one` returns 'error'.
    """
    rows = rows or {}
    analysis_errors = analysis_errors or {}

    stale_cur = MagicMock()
    cursors = [stale_cur]

    for claim in claims:
        claim_cur = MagicMock()
        claim_cur.fetchone.return_value = claim
        cursors.append(claim_cur)
        if claim is None:
            continue
        _job_id, procurement_id = claim
        row_cur = MagicMock()
        row_cur.fetchone.return_value = rows.get(procurement_id)
        cursors.append(row_cur)
        if rows.get(procurement_id) is not None and procurement_id in analysis_errors:
            error_cur = MagicMock()
            error_cur.fetchone.return_value = (analysis_errors[procurement_id],)
            cursors.append(error_cur)
        finish_cur = MagicMock()
        cursors.append(finish_cur)

    enter_calls: list = []

    def _enter_side_effect():
        cur = cursors.pop(0)
        enter_calls.append(cur)
        return cur

    def cursor_side_effect(*_args, **_kwargs):
        ctx = MagicMock()
        ctx.__exit__.return_value = False
        ctx.__enter__.side_effect = _enter_side_effect
        return ctx

    conn = MagicMock()
    conn.cursor.side_effect = cursor_side_effect
    conn.enter_calls = enter_calls
    return conn


@pytest.fixture(autouse=True)
def _no_http(monkeypatch):
    """`drain_jobs` opens its own httpx.Client when none is supplied; keep
    tests from touching the network by always passing one explicitly, but
    guard anyway in case a test forgets."""
    monkeypatch.setattr(jobs.httpx, "Client", lambda: MagicMock())


def _executed(conn):
    """All (sql, params) pairs executed across every cursor drain_jobs
    opened, in order."""
    calls = []
    for cur in conn.enter_calls:
        for c in cur.execute.call_args_list:
            args = c.args
            calls.append((args[0], args[1] if len(args) > 1 else None))
    return calls


def test_stale_requeue_runs_before_the_first_claim():
    conn = _conn(claims=[None])

    drain_jobs(conn, llm=_llm(), http_client=MagicMock())

    executed = _executed(conn)
    assert executed[0][0] == _STALE_REQUEUE_SQL
    assert executed[1][0] == _CLAIM_SQL


def test_stops_when_no_job_is_claimed():
    conn = _conn(claims=[None])

    result = drain_jobs(conn, llm=_llm(), http_client=MagicMock())

    assert result["processed"] == 0
    assert result["done"] == 0
    assert result["error"] == 0


def test_claims_analyzes_and_finishes_a_job_as_done(monkeypatch):
    conn = _conn(claims=[(5, 42), None], rows={42: _row(42)})
    monkeypatch.setattr(jobs, "analyze_one", lambda *a, **k: "done")

    result = drain_jobs(conn, llm=_llm(), http_client=MagicMock())

    assert result["processed"] == 1
    assert result["done"] == 1
    assert result["error"] == 0
    executed = _executed(conn)
    finish_calls = [c for c in executed if c[0] == _FINISH_SQL]
    assert finish_calls == [(_FINISH_SQL, {"id": 5, "status": "done", "error": None})]


def test_row_select_uses_the_claimed_procurement_id(monkeypatch):
    conn = _conn(claims=[(5, 42), None], rows={42: _row(42)})
    monkeypatch.setattr(jobs, "analyze_one", lambda *a, **k: "done")

    drain_jobs(conn, llm=_llm(), http_client=MagicMock())

    executed = _executed(conn)
    row_calls = [c for c in executed if c[0] == _SELECT_ROW_SQL]
    assert row_calls == [(_SELECT_ROW_SQL, {"procurement_id": 42})]


def test_missing_procurement_marks_error_without_calling_analyze_one(monkeypatch):
    conn = _conn(claims=[(5, 42), None], rows={42: None})
    called = []
    monkeypatch.setattr(jobs, "analyze_one", lambda *a, **k: called.append(1) or "done")

    result = drain_jobs(conn, llm=_llm(), http_client=MagicMock())

    assert called == []
    assert result["error"] == 1
    assert result["done"] == 0
    executed = _executed(conn)
    finish_calls = [c for c in executed if c[0] == _FINISH_SQL]
    assert finish_calls == [
        (_FINISH_SQL, {"id": 5, "status": "error", "error": "licitação não encontrada"})
    ]


def test_error_status_finishes_with_the_persisted_tender_analyses_error(monkeypatch):
    conn = _conn(
        claims=[(5, 42), None],
        rows={42: _row(42)},
        analysis_errors={42: "resposta inválida"},
    )
    monkeypatch.setattr(jobs, "analyze_one", lambda *a, **k: "error")

    result = drain_jobs(conn, llm=_llm(), http_client=MagicMock())

    assert result["error"] == 1
    executed = _executed(conn)
    finish_calls = [c for c in executed if c[0] == _FINISH_SQL]
    assert finish_calls == [
        (_FINISH_SQL, {"id": 5, "status": "error", "error": "resposta inválida"})
    ]


def test_exception_around_a_job_marks_it_error_and_continues(monkeypatch):
    conn = _conn(claims=[(5, 42), None], rows={42: _row(42)})

    def _boom(*a, **k):
        raise RuntimeError("kaboom " * 500)

    monkeypatch.setattr(jobs, "analyze_one", _boom)

    result = drain_jobs(conn, llm=_llm(), http_client=MagicMock())

    assert result["processed"] == 1
    assert result["error"] == 1
    conn.rollback.assert_called()
    executed = _executed(conn)
    finish_calls = [c for c in executed if c[0] == _FINISH_SQL]
    assert len(finish_calls) == 1
    finish_error = finish_calls[0][1]["error"]
    assert finish_error.startswith("kaboom")
    assert len(finish_error) <= 2000


def test_limit_stops_the_loop_even_when_jobs_remain(monkeypatch):
    claims = [(1, 10), (2, 20), (3, 30)]
    conn = _conn(claims=claims, rows={10: _row(10), 20: _row(20), 30: _row(30)})
    call_count = {"n": 0}

    def _analyze(*a, **k):
        call_count["n"] += 1
        return "done"

    monkeypatch.setattr(jobs, "analyze_one", _analyze)

    result = drain_jobs(conn, limit=2, llm=_llm(), http_client=MagicMock())

    assert call_count["n"] == 2
    assert result["processed"] == 2


def test_default_limit_is_twenty():
    assert jobs.DEFAULT_LIMIT == 20


# --- CLI -----------------------------------------------------------------


@pytest.fixture
def cli(monkeypatch):
    """Stubs the DB connection, the run log and the drain so the CLI test
    only exercises option parsing, output and the exit code."""
    calls: dict = {}
    conn = MagicMock()
    monkeypatch.setattr(analyze_cli.db, "get_connection", lambda: conn)

    result = {
        "processed": 3,
        "done": 2,
        "error": 1,
        "llm_calls": 4,
        "llm_prompt_tokens": 1000,
        "llm_completion_tokens": 200,
        "est_usd": 0.0045,
    }
    calls["result"] = result

    def _run_jobs(_conn, **kwargs):
        calls["kwargs"] = kwargs
        return calls["result"]

    monkeypatch.setattr(analyze_cli, "run_jobs", _run_jobs)
    return calls


def test_cli_reports_counts_and_usage(cli):
    result = runner.invoke(app, ["analyze", "jobs", "--limit", "5"])

    assert result.exit_code == 0
    assert "jobs: 3 processed (done 2, error 1)" in result.stdout
    assert "usage: 4 calls, 1000 prompt + 200 completion tokens, est US$ 0.0045" in result.stdout
    assert cli["kwargs"]["limit"] == 5


def test_cli_exits_0_even_when_every_job_failed(cli):
    cli["result"] = {**cli["result"], "processed": 2, "done": 0, "error": 2}

    result = runner.invoke(app, ["analyze", "jobs"])

    assert result.exit_code == 0
    assert "2 job(s) failed" in result.stderr


def test_cli_help_mentions_limit():
    result = runner.invoke(app, ["analyze", "jobs", "--help"])

    assert result.exit_code == 0
    assert "--limit" in result.stdout
