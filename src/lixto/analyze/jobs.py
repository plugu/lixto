"""The on-demand `analysis_jobs` queue behind `lixto analyze jobs`.

Ticket 134 (web) inserts a `queued` row when a user clicks "Analisar com IA"
on a procurement; a Dokploy schedule drains the queue every couple of
minutes by calling `drain_jobs` here. Unlike `lixto analyze run` (the
fenced, capped cron pass in `lixto.analyze.worker`), a job:

- bypasses the portal/modality fence and the global daily cap — the user
  already chose this one procurement;
- may target a closed procurement — an operator can re-run on purpose;
- is claimed with `FOR UPDATE SKIP LOCKED` so two overlapping schedule runs
  never race on the same row.

Each job still goes through the same `analyze_one` used by the cron pass,
so the dossier it produces is identical either way.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx
import psycopg

from lixto.analyze.worker import _apply_usage, analyze_one
from lixto.llm import LlmClient
from lixto.runs import RunCounters

logger = logging.getLogger(__name__)

DEFAULT_LIMIT = 20

# Re-queue jobs a crashed previous run left stuck in 'running' so they are
# not lost forever; 30 minutes is comfortably longer than any single
# analysis (LLM call + document extraction).
_STALE_REQUEUE_SQL = """
UPDATE analysis_jobs
SET status = 'queued', started_at = NULL
WHERE status = 'running' AND started_at < now() - interval '30 minutes'
"""

# One claim per loop iteration, committed immediately: SKIP LOCKED means a
# second, overlapping schedule run simply skips this row and claims the
# next one instead of blocking on it.
_CLAIM_SQL = """
UPDATE analysis_jobs
SET status = 'running', started_at = now()
WHERE id = (
    SELECT id FROM analysis_jobs
    WHERE status = 'queued'
    ORDER BY created_at
    LIMIT 1
    FOR UPDATE SKIP LOCKED
)
RETURNING id, procurement_id
"""

# `_SELECT_PENDING_SQL`'s select list (lixto.analyze.worker), by `p.id`
# instead of the pending predicate: no fence, no open/closed filter — an
# operator (or the user, via the "Analisar com IA" button) may deliberately
# re-run a closed procurement.
_SELECT_ROW_SQL = """
SELECT p.id,
       p.source_id,
       p.description,
       p.additional_info,
       p.modality_name,
       p.state,
       p.city_name,
       p.estimated_value,
       p.published_at,
       p.proposal_opens_at,
       p.proposal_closes_at,
       p.is_price_registry,
       a.name AS agency_name
FROM procurements p
JOIN agencies a ON a.tax_id = p.agency_tax_id
WHERE p.id = %(procurement_id)s
"""

_SELECT_ANALYSIS_ERROR_SQL = """
SELECT error FROM tender_analyses WHERE procurement_id = %(procurement_id)s
"""

_FINISH_SQL = """
UPDATE analysis_jobs
SET status = %(status)s, error = %(error)s, finished_at = now()
WHERE id = %(id)s
"""


def _finish(conn: psycopg.Connection, job_id: int, *, status: str, error: str | None) -> None:
    with conn.cursor() as cur:
        cur.execute(_FINISH_SQL, {"id": job_id, "status": status, "error": error})
    conn.commit()


def _fetch_row(conn: psycopg.Connection, procurement_id: int) -> dict[str, Any] | None:
    with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(_SELECT_ROW_SQL, {"procurement_id": procurement_id})
        return cur.fetchone()


def _fetch_analysis_error(conn: psycopg.Connection, procurement_id: int) -> str | None:
    with conn.cursor() as cur:
        cur.execute(_SELECT_ANALYSIS_ERROR_SQL, {"procurement_id": procurement_id})
        row = cur.fetchone()
    return row[0] if row else None


def drain_jobs(
    conn: psycopg.Connection,
    *,
    limit: int | None = None,
    llm: LlmClient | None = None,
    http_client: httpx.Client | None = None,
    counters: RunCounters | None = None,
) -> dict[str, Any]:
    """Drains up to `limit` (default `DEFAULT_LIMIT`) queued jobs, one at a
    time: claim → no row = stop → fetch the procurement row (missing →
    finish `error='licitação não encontrada'`) → `analyze_one` → finish with
    `done`/`error` (the worker's persisted `tender_analyses.error`, or
    `None`). Returns counters (processed, done, error, llm_*) plus
    `est_usd`, matching `lixto.analyze.worker.analyze`'s result shape.

    Any exception around a single job marks that job `error` with
    `str(exc)[:2000]` and the drain continues with the next one.
    """
    llm = llm or LlmClient()
    owns_http_client = http_client is None
    http_client = http_client or httpx.Client()

    counters = counters if counters is not None else RunCounters()
    for key in ("processed", "done", "error"):
        counters[key] = counters.get(key)

    effective_limit = limit if limit is not None else DEFAULT_LIMIT

    try:
        with conn.cursor() as cur:
            cur.execute(_STALE_REQUEUE_SQL)
        conn.commit()

        for _ in range(effective_limit):
            with conn.cursor() as cur:
                cur.execute(_CLAIM_SQL)
                claimed = cur.fetchone()
            conn.commit()
            if claimed is None:
                break
            job_id, procurement_id = claimed

            try:
                row = _fetch_row(conn, procurement_id)
                if row is None:
                    status = "error"
                    error: str | None = "licitação não encontrada"
                else:
                    status = analyze_one(conn, row, llm=llm, http_client=http_client)
                    error = (
                        _fetch_analysis_error(conn, procurement_id) if status == "error" else None
                    )
            except Exception as exc:
                logger.exception("analysis job %s failed", job_id)
                conn.rollback()
                status = "error"
                error = str(exc)[:2000]

            _finish(conn, job_id, status=status, error=error)
            counters.inc("processed")
            counters.inc(status)
            logger.info("job %s -> %s", job_id, status)
    finally:
        if owns_http_client:
            http_client.close()

    return _apply_usage(counters, llm)
