"""`lixto backfill` — resumable historical load of every modality.

Work unit: `(modality, chunk_start)` for each 7-day chunk of `[since,
until]`. A finished unit is stamped in `sync_state` under
`backfill:{modality}:{chunk_start}` with `{status: 'done', total_records,
finished_at}`; units already stamped `done` are skipped on the next run, so a
crashed or interrupted backfill resumes where it stopped. A unit that fails
after the client's retries is left unstamped (not fatal, retried next run).

After the publication phase the run drains `sync_details` in batches, bounded
by `max_details` (default 50). The bound is deliberate and small: the detail
endpoints cost ~4 requests per procurement against a portal that 429s above
~6 req/s, so an unbounded drain of a multi-month backfill runs for days
before anyone sees a procurement. The bounded drain only proves the pipeline
end-to-end on fresh data; the backlog is drained by the commands built for
it, `lixto sync details` (unbounded) and `lixto sync incremental`
(`--max-details`, default 5000). Pass `max_details=None` (CLI
`--max-details 0`) to drain fully here too.
"""

from __future__ import annotations

import logging
from collections.abc import Iterable
from datetime import UTC, date, datetime, timedelta
from typing import Any

import psycopg
from psycopg.types.json import Json

from lixto.pncp_client import PncpApiError, PncpClient
from lixto.runs import run
from lixto.sync.details import sync_details
from lixto.sync.procurements import ALL_MODALITIES, sync_publications

logger = logging.getLogger(__name__)

RUN_KIND = "backfill"
DEFAULT_SINCE = date(2026, 1, 1)
DEFAULT_CHUNK_DAYS = 7
DEFAULT_DETAILS_BATCH_SIZE = 50
DEFAULT_MAX_DETAILS = 50


def generate_chunks(
    since: date, until: date, chunk_days: int = DEFAULT_CHUNK_DAYS
) -> list[tuple[date, date]]:
    """Split the inclusive range [since, until] into `chunk_days`-wide,
    non-overlapping (start, end) date pairs, both ends inclusive.

    The final chunk is shortened to end exactly at `until` rather than
    overrunning it. Returns `[]` when `since > until`.
    """
    if since > until:
        return []

    chunks: list[tuple[date, date]] = []
    start = since
    while start <= until:
        end = min(start + timedelta(days=chunk_days - 1), until)
        chunks.append((start, end))
        start = end + timedelta(days=1)
    return chunks


def backfill_unit_key(modality: int, chunk_start: date) -> str:
    return f"backfill:{modality}:{chunk_start.isoformat()}"


def _get_done_unit_keys(conn: psycopg.Connection) -> set[str]:
    """All `backfill:*` sync_state keys already stamped `status: done`."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT key FROM sync_state WHERE key LIKE 'backfill:%' AND value ->> 'status' = 'done'"
        )
        return {row[0] for row in cur.fetchall()}


def _mark_unit_done(conn: psycopg.Connection, key: str, total_records: int) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO sync_state (key, value)
            VALUES (%(key)s, %(value)s)
            ON CONFLICT (key) DO UPDATE SET
                value = EXCLUDED.value,
                updated_at = now()
            """,
            {
                "key": key,
                "value": Json(
                    {
                        "status": "done",
                        "total_records": total_records,
                        "finished_at": datetime.now(UTC).isoformat(),
                    }
                ),
            },
        )
    conn.commit()


def backfill(
    conn: psycopg.Connection,
    *,
    since: date = DEFAULT_SINCE,
    until: date | None = None,
    modalities: Iterable[int] = ALL_MODALITIES,
    chunk_days: int = DEFAULT_CHUNK_DAYS,
    details_batch_size: int = DEFAULT_DETAILS_BATCH_SIZE,
    max_details: int | None = DEFAULT_MAX_DETAILS,
    client: PncpClient | None = None,
) -> dict[str, Any]:
    """Run every unstamped (modality, chunk) unit, then drain details.

    The whole command is one `agent_runs` row (`kind='backfill'`); nested
    phases share it rather than opening their own.
    """
    until = until or datetime.now(tz=UTC).date()
    modalities = list(modalities)
    chunks = generate_chunks(since, until, chunk_days)
    units = [(m, chunk_start, chunk_end) for m in modalities for chunk_start, chunk_end in chunks]
    total_units = len(units)

    done_keys = _get_done_unit_keys(conn)

    owns_client = client is None
    client = client or PncpClient()

    units_processed = 0
    units_skipped = 0
    records_so_far = 0
    details_processed = 0
    failed_units: list[str] = []

    try:
        with run(conn, RUN_KIND) as counters:
            counters["units_total"] = total_units
            for i, (modality, chunk_start, chunk_end) in enumerate(units, start=1):
                key = backfill_unit_key(modality, chunk_start)
                if key in done_keys:
                    units_skipped += 1
                    counters.inc("units_skipped")
                    logger.info("unit %d/%d %s: already done, skipping", i, total_units, key)
                    continue

                # Zero-result (modality, chunk) pairs are common in a full
                # backfill; the client already turns PNCP's HTTP 204 for those
                # into an empty page, so nothing to special-case here.
                try:
                    totals = sync_publications(
                        conn,
                        date_from=chunk_start,
                        date_to=chunk_end,
                        modalities=[modality],
                        client=client,
                        counters=counters,
                    )
                except PncpApiError as exc:
                    # PNCP flaps can outlast the client's retries; a failed
                    # unit must not abort an hours-long run. Left unstamped,
                    # so the next `lixto backfill` retries it.
                    conn.rollback()
                    failed_units.append(key)
                    counters.inc("units_failed")
                    logger.warning(
                        "unit %d/%d %s: failed, will retry on next run: %s",
                        i,
                        total_units,
                        key,
                        exc,
                    )
                    continue

                total_records = totals.get(modality, 0)
                records_so_far += total_records
                _mark_unit_done(conn, key, total_records)
                units_processed += 1
                counters.inc("units_processed")
                logger.info(
                    "unit %d/%d %s: totalRegistros=%d (records so far this run=%d)",
                    i,
                    total_units,
                    key,
                    total_records,
                    records_so_far,
                )

            while True:
                if max_details is not None and details_processed >= max_details:
                    logger.info(
                        "details: reached max_details=%d; remainder drains on later runs",
                        max_details,
                    )
                    break
                batch = details_batch_size
                if max_details is not None:
                    batch = min(batch, max_details - details_processed)
                n = sync_details(conn, limit=batch, client=client, counters=counters)
                details_processed += n
                logger.info("details: processed %d this batch (%d total)", n, details_processed)
                if n == 0:
                    break
    finally:
        if owns_client:
            client.close()

    if failed_units:
        logger.warning(
            "%d unit(s) failed and were left unstamped; re-run `lixto backfill` to retry: %s",
            len(failed_units),
            ", ".join(failed_units),
        )

    return {
        "units_total": total_units,
        "units_processed": units_processed,
        "units_skipped": units_skipped,
        "units_failed": failed_units,
        "details_processed": details_processed,
    }
