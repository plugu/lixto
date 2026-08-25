"""Homologated results — `procurement_results` (`/resultados`).

Drains a user-requested queue of `procurement_items` rows (marked via
`results_requested_at`, ADR 001) and fetches the homologated result (winner
tax id + unit price) for each, upserting into `procurement_results`.

Endpoint (docs/PNCP_API.md, verified live 2026-08-24, HTTP 200, bare JSON
array):
    GET /api/pncp/v1/orgaos/{cnpj}/compras/{ano}/{sequencial}/itens/{numeroItem}/resultados

This is deliberately demand-driven, never a speculative backlog crawl: a
full crawl of the ~4.06M homologated items would take weeks at
`PncpClient`'s rate limit. Only items with `results_requested_at IS NOT
NULL AND results_synced_at IS NULL` are ever fetched (partial index
`idx_procurement_items_results_queue`).

**PAGINATION TRAP (docs/PNCP_API.md):** unlike `/itens` and `/arquivos`,
`/resultados` ignores the `pagina` param — pages 2+ echo page 1 forever
(HTTP 200, same content). `PncpClient.fetch_item_results(...,
first_page_only=True)` (ticket 74) already handles this in-client; no
wrapper is needed here.

`RecuperarCompraItemResultadoDTO` also has a nested `reservaRemanescente`
object (`{codigo, nome}`) — ignored, not stored (ADR 001: no `raw` column
on `procurement_results`; the complete array is retained instead in
`source_payloads` under `entity_type='procurement_results'`, keyed by
`'<source_id>#<item_number>'`).
"""

from __future__ import annotations

import logging
from typing import Any

import psycopg

from lixto.pncp_client import PncpApiError, PncpClient
from lixto.runs import RunCounters
from lixto.sync import upsert_source_payload

logger = logging.getLogger(__name__)

RESULTS_ENTITY_TYPE = "procurement_results"

_SELECT_PENDING_SQL = """
SELECT i.procurement_id, i.item_number, p.source_id, p.agency_tax_id, p.year, p.sequence
FROM procurement_items i
JOIN procurements p ON p.id = i.procurement_id
WHERE i.results_requested_at IS NOT NULL
  AND i.results_synced_at IS NULL
ORDER BY i.results_requested_at ASC
"""

_STAMP_SQL = """
UPDATE procurement_items
SET results_synced_at = now(), updated_at = now()
WHERE procurement_id = %s AND item_number = %s
"""

_UPSERT_RESULT_SQL = """
INSERT INTO procurement_results (
    procurement_id, item_number, sequence,
    supplier_tax_id, supplier_name, supplier_kind,
    supplier_size_id, supplier_size_name,
    awarded_quantity, awarded_unit_price, awarded_total,
    discount_pct, price_registry_rank,
    status_id, status_name,
    has_subcontracting, result_date, cancelled_at,
    cancel_reason, source_created_at, source_updated_at
) VALUES (
    %(procurement_id)s, %(item_number)s, %(sequence)s,
    %(supplier_tax_id)s, %(supplier_name)s, %(supplier_kind)s,
    %(supplier_size_id)s, %(supplier_size_name)s,
    %(awarded_quantity)s, %(awarded_unit_price)s, %(awarded_total)s,
    %(discount_pct)s, %(price_registry_rank)s,
    %(status_id)s, %(status_name)s,
    %(has_subcontracting)s, %(result_date)s, %(cancelled_at)s,
    %(cancel_reason)s, %(source_created_at)s, %(source_updated_at)s
)
ON CONFLICT (procurement_id, item_number, sequence) DO UPDATE SET
    supplier_tax_id = EXCLUDED.supplier_tax_id,
    supplier_name = EXCLUDED.supplier_name,
    supplier_kind = EXCLUDED.supplier_kind,
    supplier_size_id = EXCLUDED.supplier_size_id,
    supplier_size_name = EXCLUDED.supplier_size_name,
    awarded_quantity = EXCLUDED.awarded_quantity,
    awarded_unit_price = EXCLUDED.awarded_unit_price,
    awarded_total = EXCLUDED.awarded_total,
    discount_pct = EXCLUDED.discount_pct,
    price_registry_rank = EXCLUDED.price_registry_rank,
    status_id = EXCLUDED.status_id,
    status_name = EXCLUDED.status_name,
    has_subcontracting = EXCLUDED.has_subcontracting,
    result_date = EXCLUDED.result_date,
    cancelled_at = EXCLUDED.cancelled_at,
    cancel_reason = EXCLUDED.cancel_reason,
    source_created_at = EXCLUDED.source_created_at,
    source_updated_at = EXCLUDED.source_updated_at,
    updated_at = now()
"""


def row_from_result_dto(
    procurement_id: int, item_number: int, dto: dict[str, Any]
) -> dict[str, Any]:
    """Flatten one `RecuperarCompraItemResultadoDTO` into `procurement_results`
    row params. `reservaRemanescente` is a nested `{codigo, nome}` object —
    ignored, not stored."""
    return {
        "procurement_id": procurement_id,
        "item_number": item_number,
        "sequence": dto["sequencialResultado"],
        "supplier_tax_id": dto.get("niFornecedor"),
        "supplier_name": dto.get("nomeRazaoSocialFornecedor"),
        "supplier_kind": dto.get("tipoPessoa"),
        "supplier_size_id": dto.get("porteFornecedorId"),
        "supplier_size_name": dto.get("porteFornecedorNome"),
        "awarded_quantity": dto.get("quantidadeHomologada"),
        "awarded_unit_price": dto.get("valorUnitarioHomologado"),
        "awarded_total": dto.get("valorTotalHomologado"),
        "discount_pct": dto.get("percentualDesconto"),
        "price_registry_rank": dto.get("ordemClassificacaoSrp"),
        "status_id": dto.get("situacaoCompraItemResultadoId"),
        "status_name": dto.get("situacaoCompraItemResultadoNome"),
        "has_subcontracting": dto.get("indicadorSubcontratacao"),
        "result_date": dto.get("dataResultado"),
        "cancelled_at": dto.get("dataCancelamento"),
        "cancel_reason": dto.get("motivoCancelamento"),
        "source_created_at": dto.get("dataInclusao"),
        "source_updated_at": dto.get("dataAtualizacao"),
    }


def upsert_result(
    cursor: psycopg.Cursor, procurement_id: int, item_number: int, dto: dict[str, Any]
) -> None:
    cursor.execute(_UPSERT_RESULT_SQL, row_from_result_dto(procurement_id, item_number, dto))


def _select_pending(
    conn: psycopg.Connection, *, limit: int | None
) -> list[tuple[int, int, str, str, int | None, int | None]]:
    sql = _SELECT_PENDING_SQL
    params: dict[str, Any] = {}
    if limit is not None:
        sql += " LIMIT %(limit)s"
        params["limit"] = limit
    with conn.cursor() as cur:
        cur.execute(sql, params)
        return cur.fetchall()


def sync_results(
    conn: psycopg.Connection,
    *,
    limit: int | None = None,
    client: PncpClient | None = None,
    counters: RunCounters | None = None,
) -> int:
    """Fetch and upsert `procurement_results` rows for items on the demand
    queue (`procurement_items.results_requested_at IS NOT NULL AND
    results_synced_at IS NULL`), ordered oldest-requested first, optionally
    capped by `limit`.

    `results_synced_at` is stamped even when the fetched array is empty (a
    valid, distinguishable answer from "never tried" — an item with
    genuinely no published result must not be re-fetched forever). One item
    failing after the client's retries is logged and skipped (left on the
    queue for a future run), not fatal.

    Returns the count of items successfully processed (stamped).
    """
    owns_client = client is None
    client = client or PncpClient()
    processed = 0
    try:
        rows = _select_pending(conn, limit=limit)

        for procurement_id, item_number, source_id, agency_tax_id, year, sequence in rows:
            if year is None or sequence is None:
                # The results endpoint is keyed by cnpj/ano/sequencial; with
                # either missing there is nothing to fetch, ever. Stamp it so
                # the queue doesn't hand us the same row forever.
                logger.warning(
                    "%s has no year/sequence, stamping item %s as synced", source_id, item_number
                )
                with conn.cursor() as cur:
                    cur.execute(_STAMP_SQL, (procurement_id, item_number))
                conn.commit()
                continue

            try:
                results = client.fetch_item_results(
                    agency_tax_id=agency_tax_id.strip(),
                    year=year,
                    sequence=sequence,
                    item_number=item_number,
                )
            except PncpApiError:
                logger.exception(
                    "failed to fetch results for %s item %s, skipping",
                    source_id,
                    item_number,
                )
                continue

            with conn.cursor() as cur:
                for dto in results:
                    upsert_result(cur, procurement_id, item_number, dto)
                upsert_source_payload(
                    cur,
                    entity_type=RESULTS_ENTITY_TYPE,
                    external_id=f"{source_id}#{item_number}",
                    payload=results,
                )
                cur.execute(_STAMP_SQL, (procurement_id, item_number))
            conn.commit()

            processed += 1
            if counters is not None:
                counters.inc("results_processed")
                counters.inc("results", len(results))
            logger.info("%s item %s: %d result(s)", source_id, item_number, len(results))
    finally:
        if owns_client:
            client.close()

    return processed
