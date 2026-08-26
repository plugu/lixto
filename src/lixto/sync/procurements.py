"""Procurement ingestion — PNCP `RecuperarCompraPublicacaoDTO` → `procurements`.

One page of `/v1/contratacoes/publicacao` (backfill) or `/v1/contratacoes/
atualizacao` (incremental) carries the same DTO, so both callers share
`upsert_procurement` here:

1. `agencies` + `agency_units` first (FK, `lixto.sync` helpers),
2. the `procurements` row, guarded by `WHERE
   procurements.source_global_updated_at IS NULL OR
   EXCLUDED.source_global_updated_at > procurements.source_global_updated_at`
   so a re-fetch of an unchanged procurement is a genuine no-op and a real
   update resets `items_synced_at`/`documents_synced_at` (details get
   re-fetched). The `IS NULL` arm matters: PNCP does send rows without
   `dataAtualizacaoGlobal`, and a plain `>` is NULL — hence never true — so
   such a row could never be updated again once stored,
3. the complete DTO into `source_payloads` (`entity_type='procurement'`),
   keyed by `source_id` — hot rows stay lean, reprocessing stays possible.

No portal allowlist at ingestion: everything PNCP publishes is stored.
"""

from __future__ import annotations

import logging
from collections.abc import Iterable
from datetime import date
from typing import Any

import psycopg
from psycopg.types.json import Json

from lixto.pncp_client import PncpClient
from lixto.runs import RunCounters
from lixto.sync import SOURCE_PNCP, upsert_buyer_from_dto, upsert_source_payload

logger = logging.getLogger(__name__)

# docs/PNCP_API.md: 1 Leilão eletrônico … 13 Leilão presencial. One API call
# per modality is mandatory (`codigoModalidadeContratacao` is required).
ALL_MODALITIES: list[int] = list(range(1, 14))

ENTITY_TYPE = "procurement"

_UPSERT_SQL = """
INSERT INTO procurements (
    source, source_id, agency_tax_id, unit_code, state, city_name,
    year, sequence, number, process_number,
    modality_id, modality_name, dispute_mode_id, dispute_mode_name,
    status_id, status_name, instrument_type_id, instrument_type_name,
    legal_basis_code, legal_basis_name,
    description, additional_info, is_price_registry,
    estimated_value, awarded_value,
    proposal_opens_at, proposal_closes_at, published_at,
    source_created_at, source_updated_at, source_global_updated_at,
    origin_system, origin_url, process_url, budget_sources
) VALUES (
    %(source)s, %(source_id)s, %(agency_tax_id)s, %(unit_code)s, %(state)s, %(city_name)s,
    %(year)s, %(sequence)s, %(number)s, %(process_number)s,
    %(modality_id)s, %(modality_name)s, %(dispute_mode_id)s, %(dispute_mode_name)s,
    %(status_id)s, %(status_name)s, %(instrument_type_id)s, %(instrument_type_name)s,
    %(legal_basis_code)s, %(legal_basis_name)s,
    %(description)s, %(additional_info)s, %(is_price_registry)s,
    %(estimated_value)s, %(awarded_value)s,
    %(proposal_opens_at)s, %(proposal_closes_at)s, %(published_at)s,
    %(source_created_at)s, %(source_updated_at)s, %(source_global_updated_at)s,
    %(origin_system)s, %(origin_url)s, %(process_url)s, %(budget_sources)s
)
ON CONFLICT (source, source_id) DO UPDATE SET
    agency_tax_id = EXCLUDED.agency_tax_id,
    unit_code = EXCLUDED.unit_code,
    state = EXCLUDED.state,
    city_name = EXCLUDED.city_name,
    year = EXCLUDED.year,
    sequence = EXCLUDED.sequence,
    number = EXCLUDED.number,
    process_number = EXCLUDED.process_number,
    modality_id = EXCLUDED.modality_id,
    modality_name = EXCLUDED.modality_name,
    dispute_mode_id = EXCLUDED.dispute_mode_id,
    dispute_mode_name = EXCLUDED.dispute_mode_name,
    status_id = EXCLUDED.status_id,
    status_name = EXCLUDED.status_name,
    instrument_type_id = EXCLUDED.instrument_type_id,
    instrument_type_name = EXCLUDED.instrument_type_name,
    legal_basis_code = EXCLUDED.legal_basis_code,
    legal_basis_name = EXCLUDED.legal_basis_name,
    description = EXCLUDED.description,
    additional_info = EXCLUDED.additional_info,
    is_price_registry = EXCLUDED.is_price_registry,
    estimated_value = EXCLUDED.estimated_value,
    awarded_value = EXCLUDED.awarded_value,
    proposal_opens_at = EXCLUDED.proposal_opens_at,
    proposal_closes_at = EXCLUDED.proposal_closes_at,
    published_at = EXCLUDED.published_at,
    source_created_at = EXCLUDED.source_created_at,
    source_updated_at = EXCLUDED.source_updated_at,
    source_global_updated_at = EXCLUDED.source_global_updated_at,
    origin_system = EXCLUDED.origin_system,
    origin_url = EXCLUDED.origin_url,
    process_url = EXCLUDED.process_url,
    budget_sources = EXCLUDED.budget_sources,
    items_synced_at = NULL,
    documents_synced_at = NULL,
    updated_at = now()
WHERE procurements.source_global_updated_at IS NULL
   OR EXCLUDED.source_global_updated_at > procurements.source_global_updated_at
RETURNING id
"""


def row_from_procurement_dto(
    dto: dict[str, Any], *, agency_tax_id: str, unit_code: str | None
) -> dict[str, Any]:
    """Map one `RecuperarCompraPublicacaoDTO` to `procurements` row params.

    `state`/`city_name` are denormalized from `unidadeOrgao` (hottest filters,
    ADR 001 §D3); the buyer objects themselves live in `agencies`/
    `agency_units` and the untouched DTO in `source_payloads`.
    """
    unit = dto.get("unidadeOrgao") or {}
    legal_basis = dto.get("amparoLegal") or {}
    legal_basis_code = legal_basis.get("codigo")

    return {
        "source": SOURCE_PNCP,
        "source_id": dto["numeroControlePNCP"],
        "agency_tax_id": agency_tax_id,
        "unit_code": unit_code,
        "state": unit.get("ufSigla"),
        "city_name": unit.get("municipioNome"),
        "year": dto.get("anoCompra"),
        "sequence": dto.get("sequencialCompra"),
        "number": dto.get("numeroCompra"),
        "process_number": dto.get("processo"),
        "modality_id": dto.get("modalidadeId"),
        "modality_name": dto.get("modalidadeNome"),
        "dispute_mode_id": dto.get("modoDisputaId"),
        "dispute_mode_name": dto.get("modoDisputaNome"),
        "status_id": dto.get("situacaoCompraId"),
        "status_name": dto.get("situacaoCompraNome"),
        "instrument_type_id": dto.get("tipoInstrumentoConvocatorioCodigo"),
        "instrument_type_name": dto.get("tipoInstrumentoConvocatorioNome"),
        "legal_basis_code": str(legal_basis_code) if legal_basis_code is not None else None,
        "legal_basis_name": legal_basis.get("nome"),
        "description": dto.get("objetoCompra"),
        "additional_info": dto.get("informacaoComplementar"),
        "is_price_registry": dto.get("srp"),
        "estimated_value": dto.get("valorTotalEstimado"),
        "awarded_value": dto.get("valorTotalHomologado"),
        "proposal_opens_at": dto.get("dataAberturaProposta"),
        "proposal_closes_at": dto.get("dataEncerramentoProposta"),
        "published_at": dto.get("dataPublicacaoPncp"),
        "source_created_at": dto.get("dataInclusao"),
        "source_updated_at": dto.get("dataAtualizacao"),
        "source_global_updated_at": dto.get("dataAtualizacaoGlobal"),
        "origin_system": dto.get("usuarioNome"),
        "origin_url": dto.get("linkSistemaOrigem"),
        "process_url": dto.get("linkProcessoEletronico"),
        "budget_sources": Json(dto.get("fontesOrcamentarias") or []),
    }


def upsert_procurement(cursor: psycopg.Cursor, dto: dict[str, Any]) -> int | None:
    """Upsert buyer + procurement + raw payload for one DTO.

    Returns the `procurements.id` when the row was inserted or actually
    updated, `None` when the freshness guard skipped it (already current) or
    the DTO carries no usable agency CNPJ.
    """
    agency_tax_id, unit_code = upsert_buyer_from_dto(cursor, dto)
    if agency_tax_id is None:
        logger.warning(
            "procurement %s has no usable orgaoEntidade.cnpj, skipping",
            dto.get("numeroControlePNCP"),
        )
        return None

    row = row_from_procurement_dto(dto, agency_tax_id=agency_tax_id, unit_code=unit_code)
    cursor.execute(_UPSERT_SQL, row)
    returned = cursor.fetchone()

    # The payload is retained on every fetch, even when the guard skipped the
    # hot row: it is the reprocessing input and costs one upsert.
    upsert_source_payload(
        cursor, entity_type=ENTITY_TYPE, external_id=row["source_id"], payload=dto
    )
    return returned[0] if returned else None


def sync_publications(
    conn: psycopg.Connection,
    *,
    date_from: date,
    date_to: date,
    modalities: Iterable[int] = ALL_MODALITIES,
    client: PncpClient | None = None,
    counters: RunCounters | None = None,
) -> dict[int, int]:
    """Page `/contratacoes/publicacao` per modality and upsert every DTO.

    Returns `{modality: totalRegistros}` as last reported by the API for that
    modality (the same value on every page of its range).
    """
    owns_client = client is None
    client = client or PncpClient()
    totals: dict[int, int] = {}
    try:
        for modality in modalities:
            total_records = 0
            for page in client.iter_publication_pages(
                date_from=date_from.strftime("%Y%m%d"),
                date_to=date_to.strftime("%Y%m%d"),
                modality_id=modality,
            ):
                total_records = page.get("totalRegistros", 0)
                dtos = page.get("data", [])
                with conn.cursor() as cur:
                    for dto in dtos:
                        upsert_procurement(cur, dto)
                conn.commit()
                if counters is not None:
                    counters.inc("procurements_seen", len(dtos))

                page_number = page.get("numeroPagina", 0)
                total_pages = page.get("totalPaginas", 0)
                if page_number == 1 or page_number % 25 == 0 or page_number == total_pages:
                    logger.info(
                        "modality %d: page %d/%d (%d rows this page, %d total in range)",
                        modality,
                        page_number,
                        total_pages,
                        len(dtos),
                        total_records,
                    )
            totals[modality] = total_records
            logger.info("modality %d: totalRegistros=%d", modality, total_records)
    finally:
        if owns_client:
            client.close()
    return totals
