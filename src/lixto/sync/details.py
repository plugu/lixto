"""Procurement details — items (`/itens`) and documents (`/arquivos`).

Drains the queue of procurements missing either sync stamp
(`items_synced_at IS NULL OR documents_synced_at IS NULL`, the partial index
`idx_procurements_details_pending`), open/upcoming ones first because that is
what users query for, then closed history newest-first.

For each procurement both endpoints are always (re)fetched, regardless of
which stamp was missing: the upserts are idempotent and one fetch state is
cheaper to reason about than two. Both stamps are set even when PNCP returns
an empty array (a valid answer, distinguishable from "never tried"), and a
procurement that keeps failing after the client's retries is logged and
skipped rather than aborting the drain.

The complete arrays are retained in `source_payloads` under
`entity_type='procurement_items'` / `'procurement_documents'`, keyed by the
procurement's `source_id`.
"""

from __future__ import annotations

import logging
from typing import Any

import psycopg

from lixto.pncp_client import PncpApiError, PncpClient
from lixto.runs import RunCounters
from lixto.sync import upsert_source_payload

logger = logging.getLogger(__name__)

ITEMS_ENTITY_TYPE = "procurement_items"
DOCUMENTS_ENTITY_TYPE = "procurement_documents"

# `materialOuServico` is a single letter; anything else (absent, 'O', …) is
# left NULL rather than guessed — the column has a CHECK constraint.
_KIND_BY_MATERIAL_OR_SERVICE = {"M": "material", "S": "service"}

_SELECT_PENDING_SQL = """
SELECT id, source_id, agency_tax_id, year, sequence
FROM procurements
WHERE items_synced_at IS NULL OR documents_synced_at IS NULL
ORDER BY
    -- open/upcoming first (that's the data users query for), closing-soonest
    -- first among them; closed history fills in afterwards, newest first
    COALESCE(proposal_closes_at >= now() OR proposal_opens_at > now(), false) DESC,
    CASE WHEN COALESCE(proposal_closes_at >= now() OR proposal_opens_at > now(), false)
         THEN proposal_closes_at END ASC NULLS LAST,
    published_at DESC
"""

_STAMP_SQL = """
UPDATE procurements
SET items_synced_at = now(), documents_synced_at = now(), updated_at = now()
WHERE id = %s
"""

_UPSERT_ITEM_SQL = """
INSERT INTO procurement_items (
    procurement_id, item_number, description, kind, quantity, unit,
    estimated_unit_price, estimated_total,
    judging_criterion_id, judging_criterion_name,
    status_id, status_name, benefit_type_id, benefit_type_name,
    ncm_nbs_code, catalog_code, source_created_at, source_updated_at
) VALUES (
    %(procurement_id)s, %(item_number)s, %(description)s, %(kind)s, %(quantity)s, %(unit)s,
    %(estimated_unit_price)s, %(estimated_total)s,
    %(judging_criterion_id)s, %(judging_criterion_name)s,
    %(status_id)s, %(status_name)s, %(benefit_type_id)s, %(benefit_type_name)s,
    %(ncm_nbs_code)s, %(catalog_code)s, %(source_created_at)s, %(source_updated_at)s
)
ON CONFLICT (procurement_id, item_number) DO UPDATE SET
    description = EXCLUDED.description,
    kind = EXCLUDED.kind,
    quantity = EXCLUDED.quantity,
    unit = EXCLUDED.unit,
    estimated_unit_price = EXCLUDED.estimated_unit_price,
    estimated_total = EXCLUDED.estimated_total,
    judging_criterion_id = EXCLUDED.judging_criterion_id,
    judging_criterion_name = EXCLUDED.judging_criterion_name,
    status_id = EXCLUDED.status_id,
    status_name = EXCLUDED.status_name,
    benefit_type_id = EXCLUDED.benefit_type_id,
    benefit_type_name = EXCLUDED.benefit_type_name,
    ncm_nbs_code = EXCLUDED.ncm_nbs_code,
    catalog_code = EXCLUDED.catalog_code,
    source_created_at = EXCLUDED.source_created_at,
    source_updated_at = EXCLUDED.source_updated_at,
    updated_at = now()
"""

_UPSERT_DOCUMENT_SQL = """
INSERT INTO procurement_documents (
    procurement_id, sequence, title, type_id, type_name, type_description,
    url, is_active, published_at
) VALUES (
    %(procurement_id)s, %(sequence)s, %(title)s, %(type_id)s, %(type_name)s,
    %(type_description)s, %(url)s, %(is_active)s, %(published_at)s
)
ON CONFLICT (procurement_id, sequence) DO UPDATE SET
    title = EXCLUDED.title,
    type_id = EXCLUDED.type_id,
    type_name = EXCLUDED.type_name,
    type_description = EXCLUDED.type_description,
    url = EXCLUDED.url,
    is_active = EXCLUDED.is_active,
    published_at = EXCLUDED.published_at,
    updated_at = now()
"""


def item_kind(material_or_service: Any) -> str | None:
    """`materialOuServico` 'M' → 'material', 'S' → 'service', else NULL."""
    if not isinstance(material_or_service, str):
        return None
    return _KIND_BY_MATERIAL_OR_SERVICE.get(material_or_service.strip().upper())


def row_from_item_dto(procurement_id: int, dto: dict[str, Any]) -> dict[str, Any]:
    """Map one `RecuperarCompraItemSigiloDTO` to `procurement_items` params.

    Verified live (2026-08-01): `situacaoCompraItem` and `tipoBeneficio` are
    integers with separate `...Nome` strings — hence the id/name column pairs.
    """
    return {
        "procurement_id": procurement_id,
        "item_number": dto["numeroItem"],
        "description": dto.get("descricao"),
        "kind": item_kind(dto.get("materialOuServico")),
        "quantity": dto.get("quantidade"),
        "unit": dto.get("unidadeMedida"),
        "estimated_unit_price": dto.get("valorUnitarioEstimado"),
        "estimated_total": dto.get("valorTotal"),
        "judging_criterion_id": dto.get("criterioJulgamentoId"),
        "judging_criterion_name": dto.get("criterioJulgamentoNome"),
        "status_id": dto.get("situacaoCompraItem"),
        "status_name": dto.get("situacaoCompraItemNome"),
        "benefit_type_id": dto.get("tipoBeneficio"),
        "benefit_type_name": dto.get("tipoBeneficioNome"),
        "ncm_nbs_code": dto.get("ncmNbsCodigo"),
        "catalog_code": dto.get("catalogoCodigoItem"),
        "source_created_at": dto.get("dataInclusao"),
        "source_updated_at": dto.get("dataAtualizacao"),
    }


def row_from_document_dto(procurement_id: int, dto: dict[str, Any]) -> dict[str, Any]:
    """Map one `RecuperarDadosDocumentoCompraDTO` to `procurement_documents`.

    `url` is stored exactly as given — the file itself is never downloaded
    here (PDF extraction is a later ticket's job).
    """
    return {
        "procurement_id": procurement_id,
        "sequence": dto["sequencialDocumento"],
        "title": dto.get("titulo"),
        "type_id": dto.get("tipoDocumentoId"),
        "type_name": dto.get("tipoDocumentoNome"),
        "type_description": dto.get("tipoDocumentoDescricao"),
        "url": dto.get("url"),
        "is_active": dto.get("statusAtivo"),
        "published_at": dto.get("dataPublicacaoPncp"),
    }


def upsert_item(cursor: psycopg.Cursor, procurement_id: int, dto: dict[str, Any]) -> None:
    cursor.execute(_UPSERT_ITEM_SQL, row_from_item_dto(procurement_id, dto))


def upsert_document(cursor: psycopg.Cursor, procurement_id: int, dto: dict[str, Any]) -> None:
    cursor.execute(_UPSERT_DOCUMENT_SQL, row_from_document_dto(procurement_id, dto))


def _select_pending(
    conn: psycopg.Connection, *, limit: int | None
) -> list[tuple[int, str, str, int, int]]:
    sql = _SELECT_PENDING_SQL
    params: dict[str, Any] = {}
    if limit is not None:
        sql += " LIMIT %(limit)s"
        params["limit"] = limit
    with conn.cursor() as cur:
        cur.execute(sql, params)
        return cur.fetchall()


def sync_details(
    conn: psycopg.Connection,
    *,
    limit: int | None = None,
    client: PncpClient | None = None,
    counters: RunCounters | None = None,
) -> int:
    """Fetch items + documents for procurements missing either sync stamp.

    Returns the number of procurements successfully processed (stamped).
    """
    # One client covers both PNCP APIs (the detail endpoints are absolute
    # URLs off `pncp_base_url`), so callers pass the same client they use for
    # the search API and both phases share one throttle/retry budget.
    owns_client = client is None
    client = client or PncpClient()
    processed = 0
    try:
        for procurement_id, source_id, agency_tax_id, year, sequence in _select_pending(
            conn, limit=limit
        ):
            if year is None or sequence is None:
                # The detail endpoints are keyed by cnpj/ano/sequencial; with
                # either missing there is nothing to fetch, ever. Stamp it so
                # the queue doesn't hand us the same row forever.
                logger.warning("%s has no year/sequence, stamping as synced", source_id)
                with conn.cursor() as cur:
                    cur.execute(_STAMP_SQL, (procurement_id,))
                conn.commit()
                continue

            try:
                items = client.fetch_items(
                    agency_tax_id=agency_tax_id.strip(), year=year, sequence=sequence
                )
                documents = client.fetch_documents(
                    agency_tax_id=agency_tax_id.strip(), year=year, sequence=sequence
                )
            except PncpApiError:
                logger.exception("failed to fetch details for %s, skipping", source_id)
                continue

            with conn.cursor() as cur:
                for dto in items:
                    upsert_item(cur, procurement_id, dto)
                for dto in documents:
                    upsert_document(cur, procurement_id, dto)
                upsert_source_payload(
                    cur,
                    entity_type=ITEMS_ENTITY_TYPE,
                    external_id=source_id,
                    payload=items,
                )
                upsert_source_payload(
                    cur,
                    entity_type=DOCUMENTS_ENTITY_TYPE,
                    external_id=source_id,
                    payload=documents,
                )
                cur.execute(_STAMP_SQL, (procurement_id,))
            conn.commit()

            processed += 1
            if counters is not None:
                counters.inc("details_processed")
                counters.inc("items", len(items))
                counters.inc("documents", len(documents))
            logger.info("%s: %d item(s), %d document(s)", source_id, len(items), len(documents))
    finally:
        if owns_client:
            client.close()

    return processed
