"""`lixto plans sync` — annual procurement plans (PCA) from PNCP.

Pages `/v1/pca/atualizacao` (`PncpClient.fetch_plans_update_page`), which
returns `PlanoContratacaoComItensDoUsuarioDTO` rows with their items embedded
— one fetch gets a whole plan, no separate items endpoint like procurements.

For each DTO:
- the buying `agencies` row is upserted first, through the shared
  `lixto.sync.upsert_agency` (tax_id/name only — the PCA DTO carries no
  poderId/esferaId, unlike the compras `orgaoEntidade`, so those columns are
  left alone rather than nulled over data another sync already put there;
  the shared helper also zero-pads the CNPJ to the `CHAR(14)` key form and
  never writes a NULL over a stored name);
- a DTO without a usable CNPJ or without `anoPca` is skipped — both columns
  are NOT NULL on `procurement_plans`, so writing it would abort the whole
  run on the first bad page;
- the whole DTO is written to `source_payloads` (`entity_type =
  'procurement_plan'`) unconditionally, so a plan is always reprocessable
  even when the freshness guard below skips the hot row;
- the plan row itself is upserted guarded by `source_global_updated_at`
  (`dataAtualizacaoGlobalPCA`) — a same-or-older DTO leaves the row (and its
  items) untouched;
- only when the plan row actually changed are its items replaced (delete +
  insert, inside the same transaction) — items are never merged/appended,
  the DTO's `itens` array is the full current set every time.

Watermark `sync_state` key `incremental:plans` holds the last
`dataAtualizacaoGlobalPCA` seen. The window from the watermark (or `--since`)
to `--until` (default today) is walked in <=7-day chunks — `/pca/atualizacao`
has no modality axis to split on the way `/contratacoes/atualizacao` does, so
chunking bounds how wide a single window (and its page count) can get. Each
chunk is paged to `paginasRestantes == 0` before its watermark is advanced,
so a chunk that fails partway through does not move the watermark past work
it never finished.
"""

from __future__ import annotations

import json
import logging
import time
from datetime import UTC, date, datetime, timedelta
from typing import Any

import psycopg
from psycopg.types.json import Json

from lixto.pncp_client import PncpClient
from lixto.runs import RunCounters
from lixto.sync import normalize_tax_id
from lixto.sync import upsert_agency as upsert_agency_row

logger = logging.getLogger(__name__)

DEFAULT_CHUNK_DAYS = 7

# `PncpClient`'s own retry policy covers HTTP 429/5xx; it does not cover PNCP
# occasionally answering `/pca/atualizacao` with HTTP 200 and an empty/
# truncated body (observed live 2026-08-25 — isolated on a good day, but
# clustered into multi-minute bad patches on a bad one, over a national,
# multi-thousand-page window) — `response.json()` then raises
# `json.JSONDecodeError`, which is otherwise fatal to a long-running sync.
# Exponential backoff (capped) rather than a fixed short delay so a clustered
# bad patch of several minutes doesn't kill an otherwise-healthy run.
_PAGE_FETCH_MAX_ATTEMPTS = 8
_PAGE_FETCH_RETRY_BASE_SECONDS = 3.0
_PAGE_FETCH_RETRY_MAX_DELAY_SECONDS = 60.0

_UPSERT_SOURCE_PAYLOAD_SQL = """
INSERT INTO source_payloads (source, entity_type, external_id, payload)
VALUES ('pncp', 'procurement_plan', %(external_id)s, %(payload)s)
ON CONFLICT (source, entity_type, external_id) DO UPDATE SET
    payload = EXCLUDED.payload,
    fetched_at = now()
"""

_UPSERT_PLAN_SQL = """
INSERT INTO procurement_plans (
    source, source_id, agency_tax_id, unit_code, unit_name, year,
    published_at, source_global_updated_at, item_count
) VALUES (
    'pncp', %(source_id)s, %(agency_tax_id)s, %(unit_code)s, %(unit_name)s, %(year)s,
    %(published_at)s, %(source_global_updated_at)s, %(item_count)s
)
ON CONFLICT (source, source_id) DO UPDATE SET
    agency_tax_id = EXCLUDED.agency_tax_id,
    unit_code = EXCLUDED.unit_code,
    unit_name = EXCLUDED.unit_name,
    year = EXCLUDED.year,
    published_at = EXCLUDED.published_at,
    source_global_updated_at = EXCLUDED.source_global_updated_at,
    item_count = EXCLUDED.item_count,
    updated_at = now()
WHERE procurement_plans.source_global_updated_at IS NULL
   OR EXCLUDED.source_global_updated_at > procurement_plans.source_global_updated_at
RETURNING id
"""

_DELETE_PLAN_ITEMS_SQL = "DELETE FROM procurement_plan_items WHERE plan_id = %s"

_INSERT_PLAN_ITEM_SQL = """
INSERT INTO procurement_plan_items (
    plan_id, item_number, category_name, catalog_classification_id,
    catalog_classification_name, superior_classification_code,
    superior_classification_name, pdm_code, pdm_description, item_code,
    description, supply_unit, estimated_quantity, unit_value, total_value,
    budget_year_value, requesting_unit, desired_date, contracting_group_code,
    contracting_group_name, source_created_at, source_updated_at
) VALUES (
    %(plan_id)s, %(item_number)s, %(category_name)s, %(catalog_classification_id)s,
    %(catalog_classification_name)s, %(superior_classification_code)s,
    %(superior_classification_name)s, %(pdm_code)s, %(pdm_description)s, %(item_code)s,
    %(description)s, %(supply_unit)s, %(estimated_quantity)s, %(unit_value)s, %(total_value)s,
    %(budget_year_value)s, %(requesting_unit)s, %(desired_date)s, %(contracting_group_code)s,
    %(contracting_group_name)s, %(source_created_at)s, %(source_updated_at)s
)
"""


def watermark_key() -> str:
    return "incremental:plans"


def row_from_plan_dto(dto: dict[str, Any]) -> dict[str, Any]:
    """Flatten one `PlanoContratacaoComItensDoUsuarioDTO` into a
    `procurement_plans` row (excluding `itens`, mapped separately)."""
    items = dto.get("itens") or []
    return {
        "source_id": dto["idPcaPncp"],
        "agency_tax_id": normalize_tax_id(dto.get("orgaoEntidadeCnpj")),
        "unit_code": dto.get("codigoUnidade"),
        "unit_name": dto.get("nomeUnidade"),
        "year": dto.get("anoPca"),
        "published_at": dto.get("dataPublicacaoPNCP"),
        "source_global_updated_at": dto.get("dataAtualizacaoGlobalPCA"),
        "item_count": len(items),
    }


def row_from_plan_item_dto(plan_id: int, dto: dict[str, Any]) -> dict[str, Any]:
    """Flatten one `PlanoContratacaoItemDTO` into a `procurement_plan_items` row."""
    return {
        "plan_id": plan_id,
        "item_number": dto.get("numeroItem"),
        "category_name": dto.get("categoriaItemPcaNome"),
        "catalog_classification_id": dto.get("classificacaoCatalogoId"),
        "catalog_classification_name": dto.get("nomeClassificacaoCatalogo"),
        "superior_classification_code": dto.get("classificacaoSuperiorCodigo"),
        "superior_classification_name": dto.get("classificacaoSuperiorNome"),
        "pdm_code": dto.get("pdmCodigo"),
        "pdm_description": dto.get("pdmDescricao"),
        "item_code": dto.get("codigoItem"),
        "description": dto.get("descricaoItem"),
        "supply_unit": dto.get("unidadeFornecimento"),
        "estimated_quantity": dto.get("quantidadeEstimada"),
        "unit_value": dto.get("valorUnitario"),
        "total_value": dto.get("valorTotal"),
        "budget_year_value": dto.get("valorOrcamentoExercicio"),
        "requesting_unit": dto.get("unidadeRequisitante"),
        "desired_date": dto.get("dataDesejada"),
        "contracting_group_code": dto.get("grupoContratacaoCodigo"),
        "contracting_group_name": dto.get("grupoContratacaoNome"),
        "source_created_at": dto.get("dataInclusao"),
        "source_updated_at": dto.get("dataAtualizacao"),
    }


def upsert_agency(cursor: psycopg.Cursor, dto: dict[str, Any]) -> str | None:
    """Upsert the buying agency before the plan itself; returns its tax id.

    The PCA DTO is flat (`orgaoEntidadeCnpj`/`orgaoEntidadeRazaoSocial`)
    rather than nested like `orgaoEntidade`, so this maps those two fields
    onto the shared `lixto.sync.upsert_agency` — which normalizes the CNPJ to
    the `CHAR(14)` key form, falls back to the tax id when `razaoSocial` is
    absent (`agencies.name` is NOT NULL) and COALESCEs on update so a
    nameless PCA never nulls a name another sync already stored.
    """
    return upsert_agency_row(
        cursor,
        tax_id=dto.get("orgaoEntidadeCnpj"),
        name=dto.get("orgaoEntidadeRazaoSocial"),
    )


def write_source_payload(cursor: psycopg.Cursor, dto: dict[str, Any]) -> None:
    """Persist the full DTO (including embedded `itens`) unconditionally."""
    cursor.execute(
        _UPSERT_SOURCE_PAYLOAD_SQL,
        {"external_id": dto["idPcaPncp"], "payload": Json(dto)},
    )


def replace_plan_items(cursor: psycopg.Cursor, plan_id: int, items: list[dict[str, Any]]) -> None:
    """Replace a plan's items wholesale: delete then insert the current set."""
    cursor.execute(_DELETE_PLAN_ITEMS_SQL, (plan_id,))
    for item_dto in items:
        cursor.execute(_INSERT_PLAN_ITEM_SQL, row_from_plan_item_dto(plan_id, item_dto))


def upsert_plan(
    cursor: psycopg.Cursor, dto: dict[str, Any], *, counters: RunCounters | None = None
) -> int | None:
    """Upsert one plan DTO: agency, source_payload, then the plan row
    (freshness-guarded) and, only if it changed, its items.

    Returns the plan id when the row was inserted/updated, or `None` when the
    freshness guard skipped it (an equal-or-newer row is already stored) — in
    which case items are left untouched — or when the DTO is unstorable.

    "Unstorable" means no usable `orgaoEntidadeCnpj` or no `anoPca`:
    `procurement_plans.agency_tax_id` and `.year` are both NOT NULL, so
    inserting such a row raises and aborts the whole run on the first bad
    page. It is logged, counted (`plans_skipped_incomplete`) and dropped —
    the raw DTO is still retained in `source_payloads` above, so a later fix
    can reprocess it without re-fetching.
    """
    upsert_agency(cursor, dto)
    write_source_payload(cursor, dto)

    row = row_from_plan_dto(dto)
    if row["agency_tax_id"] is None or row["year"] is None:
        logger.warning(
            "plan %s has no usable orgaoEntidadeCnpj/anoPca (%r/%r), skipping",
            row["source_id"],
            dto.get("orgaoEntidadeCnpj"),
            dto.get("anoPca"),
        )
        if counters is not None:
            counters.inc("plans_skipped_incomplete")
        return None

    cursor.execute(_UPSERT_PLAN_SQL, row)
    result = cursor.fetchone()
    if result is None:
        return None
    plan_id = result[0]

    replace_plan_items(cursor, plan_id, dto.get("itens") or [])
    return plan_id


def _get_watermark(conn: psycopg.Connection) -> str | None:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT value ->> 'watermark' FROM sync_state WHERE key = %s", (watermark_key(),)
        )
        row = cur.fetchone()
    return row[0] if row else None


def _advance_watermark(conn: psycopg.Connection, watermark: str) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO sync_state (key, value)
            VALUES (%(key)s, %(value)s)
            ON CONFLICT (key) DO UPDATE SET
                value = EXCLUDED.value,
                updated_at = now()
            """,
            {"key": watermark_key(), "value": Json({"watermark": watermark})},
        )
    conn.commit()


def _resolve_window_start(existing_watermark: str | None, since: date | None, until: date) -> date:
    """Window start, in priority order: existing watermark, `--since`, else
    `until` — a first-ever run with neither fetches nothing until the next
    run has a watermark (backfill, not this ticket, seeds history)."""
    if existing_watermark is not None:
        return datetime.fromisoformat(existing_watermark).date()
    if since is not None:
        return since
    return until


def _fetch_page(client: PncpClient, *, date_from: str, date_to: str, page: int) -> dict[str, Any]:
    """`client.fetch_plans_update_page`, retrying a bounded number of times
    on an HTTP-200-but-unparseable body (see module docstring/constants)."""
    last_exc: json.JSONDecodeError | None = None
    for attempt in range(1, _PAGE_FETCH_MAX_ATTEMPTS + 1):
        try:
            return client.fetch_plans_update_page(date_from=date_from, date_to=date_to, page=page)
        except json.JSONDecodeError as exc:
            last_exc = exc
            logger.warning(
                "plans page %d (%s..%s): unparseable response body on attempt %d/%d, retrying",
                page,
                date_from,
                date_to,
                attempt,
                _PAGE_FETCH_MAX_ATTEMPTS,
            )
            if attempt < _PAGE_FETCH_MAX_ATTEMPTS:
                delay = min(
                    _PAGE_FETCH_RETRY_BASE_SECONDS * (2 ** (attempt - 1)),
                    _PAGE_FETCH_RETRY_MAX_DELAY_SECONDS,
                )
                time.sleep(delay)
    assert last_exc is not None
    raise last_exc


def _sync_chunk(
    conn: psycopg.Connection,
    *,
    date_from: date,
    date_to: date,
    client: PncpClient,
    counters: RunCounters | None = None,
) -> tuple[int, int, int, str | None]:
    """Page one <=7-day window to exhaustion, upserting each DTO.

    Returns `(plans_seen, plans_upserted, items_seen, max_watermark_seen)`.
    """
    plans_seen = 0
    plans_upserted = 0
    items_seen = 0
    max_watermark: str | None = None

    page = 1
    while True:
        body = _fetch_page(
            client,
            date_from=date_from.strftime("%Y%m%d"),
            date_to=date_to.strftime("%Y%m%d"),
            page=page,
        )
        with conn.cursor() as cur:
            for dto in body.get("data", []):
                plan_id = upsert_plan(cur, dto, counters=counters)
                plans_seen += 1
                if plan_id is not None:
                    plans_upserted += 1
                    items_seen += len(dto.get("itens") or [])

                dto_watermark = dto.get("dataAtualizacaoGlobalPCA")
                if dto_watermark and (max_watermark is None or dto_watermark > max_watermark):
                    max_watermark = dto_watermark
        conn.commit()

        if body.get("paginasRestantes", 0) <= 0:
            break
        page += 1

    return plans_seen, plans_upserted, items_seen, max_watermark


def sync_plans(
    conn: psycopg.Connection,
    *,
    since: date | None = None,
    until: date | None = None,
    chunk_days: int = DEFAULT_CHUNK_DAYS,
    client: PncpClient | None = None,
    counters: RunCounters | None = None,
) -> dict[str, Any]:
    """Sync PCA plans updated since the watermark (or `--since`) up to
    `until` (default today), walking the window in <=`chunk_days` chunks.

    The watermark is advanced once per chunk, after that chunk is fully
    paged — a chunk that raises (`PncpApiError`, after the client's own
    retries) propagates, leaving the watermark at the last chunk that
    completed so the next run resumes there.
    """
    until = until or datetime.now(tz=UTC).date()
    window_start = _resolve_window_start(_get_watermark(conn), since, until)

    owns_client = client is None
    client = client or PncpClient()

    plans_seen_total = 0
    plans_upserted_total = 0
    items_seen_total = 0
    chunks_advanced = 0

    try:
        while window_start <= until:
            window_end = min(window_start + timedelta(days=chunk_days - 1), until)

            plans_seen, plans_upserted, items_seen, max_watermark = _sync_chunk(
                conn,
                date_from=window_start,
                date_to=window_end,
                client=client,
                counters=counters,
            )

            plans_seen_total += plans_seen
            plans_upserted_total += plans_upserted
            items_seen_total += items_seen

            new_watermark = max_watermark or f"{window_end.isoformat()}T23:59:59"
            _advance_watermark(conn, new_watermark)
            chunks_advanced += 1
            logger.info(
                "plans %s..%s: %d seen, %d upserted, watermark -> %s",
                window_start,
                window_end,
                plans_seen,
                plans_upserted,
                new_watermark,
            )

            window_start = window_end + timedelta(days=1)
    finally:
        if owns_client:
            client.close()

    if counters is not None:
        counters.inc("plans_seen", plans_seen_total)
        counters.inc("plans_upserted", plans_upserted_total)
        counters.inc("items_seen", items_seen_total)
        counters.inc("chunks", chunks_advanced)

    return {
        "plans_seen": plans_seen_total,
        "plans_upserted": plans_upserted_total,
        "items_seen": items_seen_total,
        "chunks": chunks_advanced,
    }
