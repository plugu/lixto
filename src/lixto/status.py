"""`lixto status` — operator-facing report of the current mirror state.

Row counts per ingested table, the procurement lifecycle split
(open/upcoming/closed, same predicates the web app filters on), the details
backlog and every sync watermark, as one plain-text block. Read-only.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import psycopg

# Every table this cycle's syncs write. Counted with one query each (all are
# cheap index-only counts next to the sync itself).
COUNTED_TABLES: tuple[str, ...] = (
    "agencies",
    "agency_units",
    "procurements",
    "procurement_items",
    "procurement_documents",
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

    return StatusReport(
        table_counts=table_counts,
        by_modality=by_modality,
        open=open_count,
        upcoming=upcoming,
        closed=closed,
        pending_details=pending_details,
        watermarks=watermarks,
        newest_source_global_updated_at=newest.isoformat() if newest else None,
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
    return "\n".join(lines)
