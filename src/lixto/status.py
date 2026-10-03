"""`lixto status` — operator-facing report of the current mirror state.

Row counts per ingested table, the procurement lifecycle split
(open/upcoming/closed, same predicates the web app filters on), the details
backlog and every sync watermark, as one plain-text block. Read-only.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field

import psycopg

from lixto.analyze.worker import LIXTO_ENRICH_DAILY_CAP
from lixto.classify.schema import SCHEMA_VERSION as CLASSIFY_SCHEMA_VERSION
from lixto.classify.worker import _daily_cap as _classify_daily_cap
from lixto.classify.worker import _modalities as _classify_modalities
from lixto.fence import get_fence

# Every table this cycle's syncs write. Counted with one query each (all are
# cheap index-only counts next to the sync itself).
COUNTED_TABLES: tuple[str, ...] = (
    "agencies",
    "agency_units",
    "procurements",
    "procurement_items",
    "procurement_documents",
    "procurement_results",
    "procurement_enrichments",
    "procurement_plans",
    "procurement_plan_items",
    "contracts",
    "contract_amendments",
    "source_payloads",
    "agent_runs",
)

# open  = proposal window currently accepting proposals
# upcoming = window opens in the future
# closed = window already ended (or never had one — dispensas)
_LIFECYCLE_SQL = """
SELECT
    count(*) FILTER (
        WHERE proposal_opens_at <= now() AND now() < proposal_closes_at
    ) AS open,
    count(*) FILTER (WHERE proposal_opens_at > now()) AS upcoming,
    count(*) FILTER (
        WHERE proposal_closes_at < now() OR proposal_closes_at IS NULL
    ) AS closed
FROM procurements
"""


_ENRICHED_TODAY_SQL = (
    "SELECT count(*), count(*) FILTER (WHERE status='error') "
    "FROM procurement_enrichments WHERE enriched_at >= date_trunc('day', now())"
)

_LLM_TODAY_SQL = """
SELECT
    coalesce(sum((counters->>'llm_calls')::bigint), 0),
    coalesce(sum((counters->>'llm_prompt_tokens')::bigint), 0),
    coalesce(sum((counters->>'llm_completion_tokens')::bigint), 0),
    coalesce(sum((counters->>'llm_est_usd_micros')::bigint), 0)
FROM agent_runs
WHERE kind IN ('analyze', 'analyze_jobs', 'classify') AND started_at >= date_trunc('day', now())
"""

_LLM_LAST_7D_SQL = """
SELECT coalesce(sum((counters->>'llm_est_usd_micros')::bigint), 0)
FROM agent_runs
WHERE kind IN ('analyze', 'analyze_jobs', 'classify') AND started_at >= now() - interval '7 days'
"""


def _daily_cap() -> int:
    """`LIXTO_ENRICH_DAILY_CAP` rows/day; 0 or unset means unlimited."""
    raw = os.environ.get(LIXTO_ENRICH_DAILY_CAP, "0")
    try:
        return int(raw)
    except ValueError:
        return 0


_FENCED_PENDING_SQL = """
SELECT count(*)
FROM procurements p
WHERE (p.proposal_closes_at >= now() OR p.proposal_opens_at > now())
  AND NOT EXISTS (
        SELECT 1 FROM procurement_enrichments e
        WHERE e.procurement_id = p.id
      )
"""

# The `email:` block (ticket 113). One statement over `email_messages` /
# `email_suppressions` (migration 003) — silent non-delivery has to be cheap
# to look at. `sending` is in here because a queue stranded mid-flight (worker
# killed after the claim) otherwise reads as empty; the web worker's
# `requeueStale` is what drains it.
_EMAIL_STATS_SQL = """
SELECT
    count(*) FILTER (WHERE status = 'queued') AS queued,
    count(*) FILTER (WHERE status = 'sending') AS sending,
    count(*) FILTER (WHERE status = 'sent'
                       AND sent_at >= now() - interval '24 hours') AS sent_24h,
    count(*) FILTER (WHERE status = 'failed'
                       AND updated_at >= now() - interval '24 hours') AS failed_24h,
    (SELECT count(*) FROM email_suppressions) AS suppressed
FROM email_messages
"""

_CLASSIFIED_TODAY_SQL = (
    "SELECT count(*), count(*) FILTER (WHERE status='error') "
    "FROM procurement_classifications WHERE classified_at >= date_trunc('day', now())"
)

_CLASSIFY_PENDING_SQL = """
SELECT count(*)
FROM procurements p
JOIN procurement_embeddings pe ON pe.procurement_id = p.id
WHERE p.status_id = 1
  AND (p.proposal_closes_at >= now() OR p.proposal_opens_at > now())
  AND p.modality_id = ANY(%(modalities)s)
  AND NOT EXISTS (
        SELECT 1 FROM procurement_classifications c
        WHERE c.procurement_id = p.id
          AND c.schema_version = %(schema_version)s
          AND c.status = 'done'
      )
"""


@dataclass
class StatusReport:
    table_counts: dict[str, int] = field(default_factory=dict)
    by_modality: dict[int, int] = field(default_factory=dict)
    open: int = 0
    upcoming: int = 0
    closed: int = 0
    pending_details: int = 0
    watermarks: dict[str, str | None] = field(default_factory=dict)
    newest_source_global_updated_at: str | None = None
    fence: str = ""
    enrich_daily_cap: int = 0
    enriched_today: int = 0
    enriched_today_errors: int = 0
    llm_today: dict[str, int] = field(default_factory=dict)
    llm_last_7d_est_usd_micros: int = 0
    fenced_pending: int = 0
    email: dict[str, int] = field(default_factory=dict)
    classify_daily_cap: int = 0
    classified_today: int = 0
    classified_today_errors: int = 0
    classify_pending: int = 0


def get_status(conn: psycopg.Connection) -> StatusReport:
    """Gather table counts, lifecycle split, details backlog and watermarks."""
    with conn.cursor() as cur:
        table_counts = {}
        for table in COUNTED_TABLES:
            # Table names come from the module-level tuple, never user input.
            cur.execute(f"SELECT count(*) FROM {table}")
            table_counts[table] = cur.fetchone()[0]

        cur.execute(
            "SELECT modality_id, count(*) FROM procurements "
            "GROUP BY modality_id ORDER BY modality_id"
        )
        by_modality = {row[0]: row[1] for row in cur.fetchall()}

        cur.execute(_LIFECYCLE_SQL)
        open_count, upcoming, closed = cur.fetchone()

        cur.execute(
            "SELECT count(*) FROM procurements "
            "WHERE items_synced_at IS NULL OR documents_synced_at IS NULL"
        )
        pending_details = cur.fetchone()[0]

        cur.execute(
            "SELECT key, value ->> 'watermark' FROM sync_state "
            "WHERE key LIKE 'incremental:%' ORDER BY key"
        )
        watermarks = dict(cur.fetchall())

        cur.execute("SELECT max(source_global_updated_at) FROM procurements")
        newest = cur.fetchone()[0]

        cur.execute(_ENRICHED_TODAY_SQL)
        enriched_today, enriched_today_errors = cur.fetchone()

        cur.execute(_LLM_TODAY_SQL)
        llm_calls, llm_prompt_tokens, llm_completion_tokens, llm_est_usd_micros = cur.fetchone()

        cur.execute(_LLM_LAST_7D_SQL)
        (llm_last_7d_est_usd_micros,) = cur.fetchone()

        fence = get_fence()
        fence_fragment, fence_params = fence.sql("p")
        cur.execute(_FENCED_PENDING_SQL + fence_fragment, fence_params)
        (fenced_pending,) = cur.fetchone()

        # Guarded: `lixto status` must still work on a database that predates
        # migration 003 (email_messages/email_suppressions) — report zeros
        # rather than fail the whole report.
        cur.execute("SELECT to_regclass('email_messages') IS NOT NULL")
        (has_email_messages,) = cur.fetchone()
        if has_email_messages:
            cur.execute(_EMAIL_STATS_SQL)
            queued, sending, sent_24h, failed_24h, suppressed = cur.fetchone()
        else:
            queued = sending = sent_24h = failed_24h = suppressed = 0

        # Guarded like email: databases predating migration 009 report zeros.
        cur.execute("SELECT to_regclass('procurement_classifications') IS NOT NULL")
        (has_classifications,) = cur.fetchone()
        if has_classifications:
            cur.execute(_CLASSIFIED_TODAY_SQL)
            classified_today, classified_today_errors = cur.fetchone()
            cur.execute(
                _CLASSIFY_PENDING_SQL,
                {
                    "modalities": _classify_modalities(),
                    "schema_version": CLASSIFY_SCHEMA_VERSION,
                },
            )
            (classify_pending,) = cur.fetchone()
        else:
            classified_today = classified_today_errors = classify_pending = 0

    return StatusReport(
        table_counts=table_counts,
        by_modality=by_modality,
        open=open_count,
        upcoming=upcoming,
        closed=closed,
        pending_details=pending_details,
        watermarks=watermarks,
        newest_source_global_updated_at=newest.isoformat() if newest else None,
        fence=fence.describe(),
        enrich_daily_cap=_daily_cap(),
        enriched_today=enriched_today,
        enriched_today_errors=enriched_today_errors,
        llm_today={
            "calls": llm_calls,
            "prompt_tokens": llm_prompt_tokens,
            "completion_tokens": llm_completion_tokens,
            "est_usd_micros": llm_est_usd_micros,
        },
        llm_last_7d_est_usd_micros=llm_last_7d_est_usd_micros,
        fenced_pending=fenced_pending,
        email={
            "queued": queued,
            "sending": sending,
            "sent_24h": sent_24h,
            "failed_24h": failed_24h,
            "suppressed": suppressed,
        },
        classify_daily_cap=_classify_daily_cap(),
        classified_today=classified_today,
        classified_today_errors=classified_today_errors,
        classify_pending=classify_pending,
    )


def format_status(report: StatusReport) -> str:
    lines = ["tables:"]
    lines += [f"  {table}: {count}" for table, count in report.table_counts.items()]
    lines.append("procurements by modality:")
    lines += [f"  {modality}: {count}" for modality, count in sorted(report.by_modality.items())]
    lines += [
        f"open: {report.open}",
        f"upcoming: {report.upcoming}",
        f"closed: {report.closed}",
        f"pending details (items/documents): {report.pending_details}",
        "watermarks:",
    ]
    if report.watermarks:
        lines += [f"  {key}: {value}" for key, value in sorted(report.watermarks.items())]
    else:
        lines.append("  (none)")
    lines.append(f"newest source_global_updated_at: {report.newest_source_global_updated_at}")

    cap = "unlimited" if report.enrich_daily_cap == 0 else str(report.enrich_daily_cap)
    llm_today = report.llm_today
    llm_today_usd = llm_today.get("est_usd_micros", 0) / 1_000_000
    llm_7d_usd = report.llm_last_7d_est_usd_micros / 1_000_000
    today_line = (
        f"  today: {report.enriched_today} enriched ({report.enriched_today_errors} errors)"
        f" / cap {cap}"
    )
    llm_today_line = (
        f"  llm today: {llm_today.get('calls', 0)} calls, "
        f"{llm_today.get('prompt_tokens', 0)} prompt + "
        f"{llm_today.get('completion_tokens', 0)} completion tokens, "
        f"est US$ {llm_today_usd:.4f}"
    )
    lines += [
        "enrichment:",
        f"  {report.fence}",
        today_line,
        f"  pending in fence: {report.fenced_pending}",
        llm_today_line,
        f"  llm last 7 days: est US$ {llm_7d_usd:.2f}",
    ]

    classify_cap = "unlimited" if report.classify_daily_cap == 0 else str(report.classify_daily_cap)
    lines += [
        "classification:",
        (
            f"  today: {report.classified_today} classified "
            f"({report.classified_today_errors} errors) / cap {classify_cap}"
        ),
        f"  pending: {report.classify_pending}",
    ]

    email = report.email
    lines += [
        "email:",
        f"  queued: {email.get('queued', 0)}",
        f"  sending: {email.get('sending', 0)}",
        f"  sent (24h): {email.get('sent_24h', 0)}",
        f"  failed (24h): {email.get('failed_24h', 0)}",
        f"  suppressed: {email.get('suppressed', 0)}",
    ]
    return "\n".join(lines)
