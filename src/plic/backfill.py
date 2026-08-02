"""`plic backfill` — resumable full backfill of every modalidade over 7-day
date chunks, followed by `sync detalhes` until every licitação has itens and
arquivos.

Work unit: (modalidade, chunk_start) for chunk_start in 7-day chunks of
[since, until]. Each unit calls ticket-02's `sync_publicacao` for that
modalidade/date-range and then stamps `sync_state` key
`backfill:{modalidade}:{chunk_start}` with `{status: "done",
total_registros, finished_at}`. On start, units already stamped `done` are
skipped — a crashed/interrupted run resumes where it stopped.

mvp mode: one straight-line loop, no parallelism, no watermark/atualização
sync (that's ticket 05) — see PRODUCT.md "Not included" in the ticket.
"""

from __future__ import annotations

import logging
from collections.abc import Iterable
from datetime import UTC, date, datetime, timedelta
from typing import Any

import psycopg
from psycopg.types.json import Json

from plic.pncp_client import PncpClient
from plic.sync_detalhes import BASE_URL_PNCP, sync_detalhes
from plic.sync_publicacao import ALL_MODALIDADES, sync_publicacao

logger = logging.getLogger(__name__)

DEFAULT_SINCE = date(2026, 1, 1)
DEFAULT_CHUNK_DAYS = 7
DEFAULT_DETALHES_BATCH_SIZE = 500


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


def backfill_unit_key(modalidade: int, chunk_start: date) -> str:
    return f"backfill:{modalidade}:{chunk_start.isoformat()}"


def _get_done_unit_keys(conn: psycopg.Connection) -> set[str]:
    """All `backfill:*` sync_state keys already stamped `status: done`."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT key FROM sync_state "
            "WHERE key LIKE 'backfill:%' AND value ->> 'status' = 'done'"
        )
        return {row[0] for row in cur.fetchall()}


def _mark_unit_done(conn: psycopg.Connection, key: str, total_registros: int) -> None:
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
                        "total_registros": total_registros,
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
    modalidades: Iterable[int] = ALL_MODALIDADES,
    chunk_days: int = DEFAULT_CHUNK_DAYS,
    detalhes_batch_size: int = DEFAULT_DETALHES_BATCH_SIZE,
    publicacao_client: PncpClient | None = None,
    detalhes_client: PncpClient | None = None,
) -> dict[str, Any]:
    """Resumable backfill: every (modalidade, 7-day chunk) unit from `since`
    to `until` (default today), then `sync_detalhes` in batches until no
    licitação is missing itens/arquivos.

    `publicacao_client`/`detalhes_client` let callers (tests) inject fake
    clients; note `sync_publicacao` and `sync_detalhes` hit different PNCP
    base URLs (consulta vs pncp), so they are two separate clients, each
    owned/closed here unless supplied by the caller.
    """
    until = until or datetime.now(tz=UTC).date()
    modalidades = list(modalidades)
    chunks = generate_chunks(since, until, chunk_days)
    units = [(m, chunk_start, chunk_end) for m in modalidades for chunk_start, chunk_end in chunks]
    total_units = len(units)

    done_keys = _get_done_unit_keys(conn)

    owns_publicacao_client = publicacao_client is None
    owns_detalhes_client = detalhes_client is None
    publicacao_client = publicacao_client or PncpClient()
    detalhes_client = detalhes_client or PncpClient(base_url=BASE_URL_PNCP)

    units_processed = 0
    units_skipped = 0
    rows_so_far = 0
    detalhes_processed = 0

    try:
        for i, (modalidade, chunk_start, chunk_end) in enumerate(units, start=1):
            key = backfill_unit_key(modalidade, chunk_start)
            if key in done_keys:
                units_skipped += 1
                logger.info("unit %d/%d %s: already done, skipping", i, total_units, key)
                continue

            # Zero-result modalidade/date-range chunks (common across a full
            # backfill) come back as an empty page — the client centralizes
            # PNCP's HTTP-204-for-zero-results quirk into that, so no
            # special-casing is needed here (ticket 05).
            totals = sync_publicacao(
                conn,
                data_inicial=chunk_start,
                data_final=chunk_end,
                modalidades=[modalidade],
                client=publicacao_client,
            )
            total_registros = totals.get(modalidade, 0)
            rows_so_far += total_registros
            _mark_unit_done(conn, key, total_registros)
            units_processed += 1
            logger.info(
                "unit %d/%d %s: totalRegistros=%d (rows so far this run=%d)",
                i,
                total_units,
                key,
                total_registros,
                rows_so_far,
            )

        while True:
            n = sync_detalhes(conn, limit=detalhes_batch_size, client=detalhes_client)
            detalhes_processed += n
            logger.info("detalhes: processed %d this batch (%d total)", n, detalhes_processed)
            if n == 0:
                break
    finally:
        if owns_publicacao_client:
            publicacao_client.close()
        if owns_detalhes_client:
            detalhes_client.close()

    return {
        "units_total": total_units,
        "units_processed": units_processed,
        "units_skipped": units_skipped,
        "detalhes_processed": detalhes_processed,
    }
