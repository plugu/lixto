"""`lixto sync incremental` — the scheduled run: everything changed since
each modality's watermark, then a bounded details drain.

`/v1/contratacoes/atualizacao` has the same params/DTO as `/publicacao` but
filters on `dataAtualizacaoGlobal`, so it catches new procurements *and*
edits/addenda/status changes on existing ones. It reuses
`upsert_procurement`, whose freshness guard already resets the detail stamps
on a real update.

Per-modality watermark: `sync_state` key `incremental:procurements:{modality}`
holding `{"watermark": "<max dataAtualizacaoGlobal seen>"}`. Window start, in
priority order: the modality's own watermark, else `--since`, else — first
run ever — the newest `source_global_updated_at` in the DB (bootstrap; small
because backfill ran first). Window end is always `until` (default today).
Day-granularity overlap is expected and harmless: the upsert only writes when
the incoming row is strictly fresher. The watermark advances for every
modality that completed without error, including quiet ones with zero changes,
so their window can't creep wider run after run. One modality failing after
retries is logged and skipped; the returned summary flags it so the CLI can
exit non-zero for the scheduler.
"""

from __future__ import annotations

import logging
from collections.abc import Iterable
from datetime import UTC, date, datetime
from typing import Any

import psycopg
from psycopg.types.json import Json

from lixto.pncp_client import PncpApiError, PncpClient
from lixto.runs import RunCounters, run
from lixto.sync.details import sync_details
from lixto.sync.procurements import ALL_MODALITIES, upsert_procurement

logger = logging.getLogger(__name__)

RUN_KIND = "sync.procurements"
WATERMARK_PREFIX = "incremental:procurements:"
DEFAULT_DETAILS_BATCH_SIZE = 100
DEFAULT_MAX_DETAILS = 5000


def watermark_key(modality: int) -> str:
    return f"{WATERMARK_PREFIX}{modality}"


def _get_existing_watermarks(conn: psycopg.Connection) -> dict[int, str | None]:
    """All `incremental:procurements:*` watermarks, keyed by modality."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT key, value ->> 'watermark' FROM sync_state WHERE key LIKE %s",
            (f"{WATERMARK_PREFIX}%",),
        )
        rows = cur.fetchall()
    return {int(key.rsplit(":", 1)[1]): watermark for key, watermark in rows}


def _bootstrap_start_date(conn: psycopg.Connection) -> date:
    """First-ever-run fallback: the newest `source_global_updated_at` already
    in the DB (populated by backfill), so the window stays small. Falls back
    to today when the table is empty (nothing to catch up on)."""
    with conn.cursor() as cur:
        cur.execute("SELECT max(source_global_updated_at) FROM procurements")
        row = cur.fetchone()
    newest = row[0] if row else None
    return newest.date() if newest is not None else datetime.now(UTC).date()


def _resolve_window_start(
    existing_watermark: str | None, since: date | None, bootstrap_date: date
) -> date:
    """Window start for one modality's `/atualizacao` query."""
    if existing_watermark is not None:
        return datetime.fromisoformat(existing_watermark).date()
    if since is not None:
        return since
    return bootstrap_date


def _advance_watermark(conn: psycopg.Connection, modality: int, watermark: str) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO sync_state (key, value)
            VALUES (%(key)s, %(value)s)
            ON CONFLICT (key) DO UPDATE SET
                value = EXCLUDED.value,
                updated_at = now()
            """,
            {"key": watermark_key(modality), "value": Json({"watermark": watermark})},
        )
    conn.commit()


def _sync_modality(
    conn: psycopg.Connection,
    *,
    modality: int,
    date_from: date,
    date_to: date,
    client: PncpClient,
    counters: RunCounters | None = None,
) -> tuple[int, str | None]:
    """Page `/atualizacao` for one modality, upserting each DTO.

    Returns `(rows_seen, max dataAtualizacaoGlobal seen)`, the latter `None`
    when the modality had no changes. Those strings share one fixed ISO-8601
    shape, so plain string comparison sorts them chronologically.
    """
    seen_max: str | None = None
    rows_seen = 0
    for page in client.iter_update_pages(
        date_from=date_from.strftime("%Y%m%d"),
        date_to=date_to.strftime("%Y%m%d"),
        modality_id=modality,
    ):
        with conn.cursor() as cur:
            for dto in page.get("data", []):
                upsert_procurement(cur, dto)
                rows_seen += 1
                dto_watermark = dto.get("dataAtualizacaoGlobal")
                if dto_watermark and (seen_max is None or dto_watermark > seen_max):
                    seen_max = dto_watermark
        conn.commit()
        if counters is not None:
            counters.inc("procurements_seen", len(page.get("data", [])))
    return rows_seen, seen_max


def sync_incremental(
    conn: psycopg.Connection,
    *,
    since: date | None = None,
    until: date | None = None,
    modalities: Iterable[int] = ALL_MODALITIES,
    details_batch_size: int = DEFAULT_DETAILS_BATCH_SIZE,
    max_details: int | None = DEFAULT_MAX_DETAILS,
    client: PncpClient | None = None,
) -> dict[str, Any]:
    """Sync every modality's `/atualizacao` changes, then drain details.

    `max_details` bounds the details drain per run (default 5000): an
    unbounded run once spent days draining a backlog while zero new
    procurements were ingested, hiding short-window dispensas. `None` drains
    fully.

    The whole command is one `agent_runs` row (`kind='sync.procurements'`).
    """
    until = until or datetime.now(tz=UTC).date()
    modalities = list(modalities)

    existing_watermarks = _get_existing_watermarks(conn)
    bootstrap_date = _bootstrap_start_date(conn)

    owns_client = client is None
    client = client or PncpClient()

    rows_seen_total = 0
    modalities_advanced = 0
    failed_modalities: list[int] = []
    details_processed = 0

    try:
        with run(conn, RUN_KIND) as counters:
            counters["modalities_total"] = len(modalities)
            for modality in modalities:
                existing_watermark = existing_watermarks.get(modality)
                date_from = _resolve_window_start(existing_watermark, since, bootstrap_date)

                try:
                    rows_seen, seen_max = _sync_modality(
                        conn,
                        modality=modality,
                        date_from=date_from,
                        date_to=until,
                        client=client,
                        counters=counters,
                    )
                except PncpApiError:
                    logger.exception(
                        "modality %d: incremental sync failed after retries, "
                        "watermark not advanced",
                        modality,
                    )
                    failed_modalities.append(modality)
                    counters.inc("modalities_failed")
                    continue

                rows_seen_total += rows_seen
                # Advance even on zero rows: otherwise a quiet modality never
                # moves forward, and one that never had a watermark keeps
                # re-scanning a widening bootstrap window every run.
                new_watermark = seen_max or existing_watermark or f"{until.isoformat()}T00:00:00"
                _advance_watermark(conn, modality, new_watermark)
                modalities_advanced += 1
                counters.inc("modalities_advanced")
                logger.info(
                    "modality %d: %d row(s) seen, watermark -> %s",
                    modality,
                    rows_seen,
                    new_watermark,
                )

            while True:
                if max_details is not None and details_processed >= max_details:
                    logger.info(
                        "details: reached max_details=%d for this run; "
                        "remainder drains on later runs",
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

    return {
        "modalities_total": len(modalities),
        "modalities_advanced": modalities_advanced,
        "modalities_failed": failed_modalities,
        "rows_seen": rows_seen_total,
        "details_processed": details_processed,
    }
