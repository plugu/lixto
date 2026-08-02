"""`plic sync incremental` — the twice-daily run: pulls everything changed
since each modalidade's watermark from `/v1/contratacoes/atualizacao` and
then runs `sync detalhes` until drained.

Endpoint `/v1/contratacoes/atualizacao` has identical params/DTO shape to
`/publicacao` (docs/PNCP_API.md) but filters on `dataAtualizacaoGlobal`
instead of publication date, so it catches new licitações AND edits/
addenda/status changes on existing ones. Reuses ticket-02's
`upsert_licitacao` (freshness-guarded, already NULLs `*_sincronizados_em` on
real updates).

Per-modalidade watermark lives in `sync_state` key `incremental:{modalidade}`
as `{"watermark": "<max dataAtualizacaoGlobal string seen>"}`. Query window
start, in priority order: the modalidade's own watermark (it already ran
once), else `--since`, else — first-ever run — the newest
`data_atualizacao_global` already in the DB (bootstrap; kept small because
ticket-04's backfill already populated the mirror). Window end is always
today. Day-granularity re-fetch overlap is expected and harmless (the
upsert only writes when the incoming row is strictly fresher). The
watermark is advanced for every modalidade that completes without error —
even one with zero changes this run still gets its watermark bumped to
`until`, so a quiet modalidade's window doesn't creep wider run after run.
One modalidade failing after retries is logged and skipped (not fatal to
the run) so the rest still complete; the run's return value flags which
modalidades failed so the caller (CLI) can exit non-zero for the scheduler.

mvp mode: one straight-line per-modalidade loop, no parallelism.
"""

from __future__ import annotations

import logging
from collections.abc import Iterable
from datetime import UTC, date, datetime
from typing import Any

import psycopg
from psycopg.types.json import Json

from plic.pncp_client import PncpApiError, PncpClient
from plic.sync_detalhes import BASE_URL_PNCP, sync_detalhes
from plic.sync_publicacao import ALL_MODALIDADES, upsert_licitacao

logger = logging.getLogger(__name__)

DEFAULT_DETALHES_BATCH_SIZE = 500


def watermark_key(modalidade: int) -> str:
    return f"incremental:{modalidade}"


def _get_existing_watermarks(conn: psycopg.Connection) -> dict[int, str | None]:
    """All `incremental:*` watermarks already recorded, keyed by modalidade."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT key, value ->> 'watermark' FROM sync_state WHERE key LIKE 'incremental:%'"
        )
        rows = cur.fetchall()
    return {int(key.split(":", 1)[1]): watermark for key, watermark in rows}


def _bootstrap_start_date(conn: psycopg.Connection) -> date:
    """First-ever-run fallback: the newest `data_atualizacao_global` already
    in the DB (populated by backfill), so the window stays small. Falls back
    to today if the DB is somehow empty (nothing to catch up on) — a
    real-world edge case shouldn't hit this since backfill runs first."""
    with conn.cursor() as cur:
        cur.execute("SELECT max(data_atualizacao_global) FROM licitacao")
        row = cur.fetchone()
    newest = row[0] if row else None
    return newest.date() if newest is not None else datetime.now(UTC).date()


def _resolve_window_start(
    existing_watermark: str | None, since: date | None, bootstrap_date: date
) -> date:
    """Window start for one modalidade's `/atualizacao` query."""
    if existing_watermark is not None:
        return datetime.fromisoformat(existing_watermark).date()
    if since is not None:
        return since
    return bootstrap_date


def _advance_watermark(conn: psycopg.Connection, modalidade: int, watermark: str) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO sync_state (key, value)
            VALUES (%(key)s, %(value)s)
            ON CONFLICT (key) DO UPDATE SET
                value = EXCLUDED.value,
                updated_at = now()
            """,
            {"key": watermark_key(modalidade), "value": Json({"watermark": watermark})},
        )
    conn.commit()


def _sync_modalidade(
    conn: psycopg.Connection,
    *,
    modalidade: int,
    data_inicial: date,
    data_final: date,
    client: PncpClient,
) -> tuple[int, str | None]:
    """Page `/atualizacao` for one modalidade, upserting each DTO.

    Returns `(rows_seen, max_data_atualizacao_global_seen)` — the latter is
    `None` when zero rows were seen this run. `dataAtualizacaoGlobal` strings
    are all the same fixed ISO-8601 shape, so plain string comparison sorts
    them chronologically without parsing.
    """
    seen_max: str | None = None
    rows_seen = 0
    for page in client.iter_atualizacao_pages(
        data_inicial=data_inicial.strftime("%Y%m%d"),
        data_final=data_final.strftime("%Y%m%d"),
        codigo_modalidade_contratacao=modalidade,
    ):
        with conn.cursor() as cur:
            for dto in page.get("data", []):
                upsert_licitacao(cur, dto)
                rows_seen += 1
                dto_watermark = dto.get("dataAtualizacaoGlobal")
                if dto_watermark and (seen_max is None or dto_watermark > seen_max):
                    seen_max = dto_watermark
        conn.commit()
    return rows_seen, seen_max


def sync_incremental(
    conn: psycopg.Connection,
    *,
    since: date | None = None,
    until: date | None = None,
    modalidades: Iterable[int] = ALL_MODALIDADES,
    detalhes_batch_size: int = DEFAULT_DETALHES_BATCH_SIZE,
    client: PncpClient | None = None,
    detalhes_client: PncpClient | None = None,
) -> dict[str, Any]:
    """Sync every modalidade's `/atualizacao` changes since its watermark,
    then `sync_detalhes` in batches until no licitação is missing itens/
    arquivos.

    Returns a summary dict including `modalidades_failed` — non-empty means
    the run should be surfaced as a failure by the caller, even though every
    other modalidade still ran to completion.
    """
    until = until or datetime.now(tz=UTC).date()
    modalidades = list(modalidades)

    existing_watermarks = _get_existing_watermarks(conn)
    bootstrap_date = _bootstrap_start_date(conn)

    owns_client = client is None
    owns_detalhes_client = detalhes_client is None
    client = client or PncpClient()
    detalhes_client = detalhes_client or PncpClient(base_url=BASE_URL_PNCP)

    rows_seen_total = 0
    modalidades_advanced = 0
    failed_modalidades: list[int] = []
    detalhes_processed = 0

    try:
        for modalidade in modalidades:
            existing_watermark = existing_watermarks.get(modalidade)
            data_inicial = _resolve_window_start(existing_watermark, since, bootstrap_date)

            try:
                rows_seen, seen_max = _sync_modalidade(
                    conn,
                    modalidade=modalidade,
                    data_inicial=data_inicial,
                    data_final=until,
                    client=client,
                )
            except PncpApiError:
                logger.exception(
                    "modalidade %d: incremental sync failed after retries, "
                    "watermark not advanced",
                    modalidade,
                )
                failed_modalidades.append(modalidade)
                continue

            rows_seen_total += rows_seen
            # Advance even on zero rows seen — otherwise a quiet modalidade
            # with an already-set watermark would never move forward, and one
            # that's never had a watermark would keep re-scanning a widening
            # bootstrap window every run.
            new_watermark = seen_max or existing_watermark or f"{until.isoformat()}T00:00:00"
            _advance_watermark(conn, modalidade, new_watermark)
            modalidades_advanced += 1
            logger.info(
                "modalidade %d: %d row(s) seen, watermark -> %s",
                modalidade,
                rows_seen,
                new_watermark,
            )

        while True:
            n = sync_detalhes(conn, limit=detalhes_batch_size, client=detalhes_client)
            detalhes_processed += n
            logger.info("detalhes: processed %d this batch (%d total)", n, detalhes_processed)
            if n == 0:
                break
    finally:
        if owns_client:
            client.close()
        if owns_detalhes_client:
            detalhes_client.close()

    return {
        "modalidades_total": len(modalidades),
        "modalidades_advanced": modalidades_advanced,
        "modalidades_failed": failed_modalidades,
        "rows_seen": rows_seen_total,
        "detalhes_processed": detalhes_processed,
    }
