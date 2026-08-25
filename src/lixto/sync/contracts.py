"""`lixto contracts sync` — pulls contracts and their amendments from PNCP
into `contracts` / `contract_amendments` (ADR 001).

Two independent phases, each wrapped by the caller in its own
`lixto.runs.run` (`"sync.contracts"` / `"sync.amendments"`):

- `sync_contracts`: pages `/v1/contratos/atualizacao` (filtered on
  `dataAtualizacaoGlobal`, same envelope shape as `/v1/contratos`) from a
  single watermark (`sync_state` key `incremental:contracts`) to today,
  upserting `agencies`/`agency_units` first (contracts FK-reference the
  agency), then the contract itself guarded by `source_global_updated_at`
  (a same-or-older incoming row is a no-op, mirroring
  `plic.sync_publicacao.upsert_licitacao`), resolving `procurement_id` with
  a `SELECT id FROM procurements WHERE source='pncp' AND source_id =
  numeroControlePncpCompra` (NULL when the procurement hasn't been synced —
  a contract may arrive on PNCP before, or independently of, the
  procurement it stems from), and writing the raw DTO to `source_payloads`
  (`entity_type='contract'`). The query window is
  chunked into `CHUNK_DAYS`-day slices (documented behavior of the ticket,
  independent of pagination within a slice) so one call to `sync_contracts`
  can bootstrap an arbitrarily wide `--since` without a single oversized
  request. The watermark advances once per run to the max
  `dataAtualizacaoGlobal` seen; on a zero-row run it jumps to `until` only
  when there was no watermark yet (first-ever run — otherwise the bootstrap
  window would re-widen every day), and is otherwise left exactly as it
  was (the window it already defines reaches `until` again next run). It
  is also left untouched when the resolved window start is after `until`
  (e.g. a `--since` in the future).

- `sync_amendments`: for contracts with `amendments_synced_at IS NULL`
  (`idx_contracts_amendments_pending`), fetches `/termos` (bare array,
  `PncpClient.fetch_contract_amendments`), replaces that contract's
  `contract_amendments` rows wholesale, writes the raw array to
  `source_payloads` (`entity_type='contract_amendments'`,
  `external_id=<contract source_id>`), and stamps `amendments_synced_at`
  even when the array came back empty (a valid, distinguishable "checked,
  has none" from "never checked"). Commits per contract so a crash only
  loses the in-flight one; one contract failing after retries is logged and
  skipped, not fatal to the run.

mvp-adjacent shortcut kept from the legacy sync (docs/adr/001, D-none):
straight-line per-window/per-contract loops, no parallelism.
"""

from __future__ import annotations

import logging
from collections.abc import Iterator
from datetime import UTC, date, datetime, timedelta
from typing import Any

import psycopg
from psycopg.types.json import Json

from lixto.pncp_client import PncpApiError, PncpClient
from lixto.runs import RunCounters

logger = logging.getLogger(__name__)

WATERMARK_KEY = "incremental:contracts"
CHUNK_DAYS = 7

# ---------------------------------------------------------------- upserts

_UPSERT_AGENCY_SQL = """
INSERT INTO agencies (tax_id, name, power_code, sphere_code)
VALUES (%(tax_id)s, %(name)s, %(power_code)s, %(sphere_code)s)
ON CONFLICT (tax_id) DO UPDATE SET
    name = EXCLUDED.name,
    power_code = EXCLUDED.power_code,
    sphere_code = EXCLUDED.sphere_code,
    updated_at = now()
"""

_UPSERT_AGENCY_UNIT_SQL = """
INSERT INTO agency_units (agency_tax_id, code, name, state, city_name, ibge_code)
VALUES (%(agency_tax_id)s, %(code)s, %(name)s, %(state)s, %(city_name)s, %(ibge_code)s)
ON CONFLICT (agency_tax_id, code) DO UPDATE SET
    name = EXCLUDED.name,
    state = EXCLUDED.state,
    city_name = EXCLUDED.city_name,
    ibge_code = EXCLUDED.ibge_code,
    updated_at = now()
"""

_UPSERT_CONTRACT_SQL = """
INSERT INTO contracts (
    source, source_id, procurement_source_id, procurement_id,
    price_registry_source_id, agency_tax_id, unit_code, year, sequence,
    contract_number, process_number, type_id, type_name, category_id, category_name,
    supplier_tax_id, supplier_name, supplier_kind, supplier_country_code,
    subcontractor_tax_id, subcontractor_name, description, additional_info,
    is_revenue, installments, installment_value, initial_value, global_value, accumulated_value,
    signed_at, starts_at, ends_at, published_at,
    source_updated_at, source_global_updated_at,
    from_price_registry, parliamentary_amendment, origin_system
) VALUES (
    %(source)s, %(source_id)s, %(procurement_source_id)s, %(procurement_id)s,
    %(price_registry_source_id)s, %(agency_tax_id)s, %(unit_code)s, %(year)s, %(sequence)s,
    %(contract_number)s, %(process_number)s, %(type_id)s, %(type_name)s, %(category_id)s, %(category_name)s,
    %(supplier_tax_id)s, %(supplier_name)s, %(supplier_kind)s, %(supplier_country_code)s,
    %(subcontractor_tax_id)s, %(subcontractor_name)s, %(description)s, %(additional_info)s,
    %(is_revenue)s, %(installments)s, %(installment_value)s, %(initial_value)s, %(global_value)s,
    %(accumulated_value)s,
    %(signed_at)s, %(starts_at)s, %(ends_at)s, %(published_at)s,
    %(source_updated_at)s, %(source_global_updated_at)s,
    %(from_price_registry)s, %(parliamentary_amendment)s, %(origin_system)s
)
ON CONFLICT (source, source_id) DO UPDATE SET
    procurement_source_id = EXCLUDED.procurement_source_id,
    procurement_id = EXCLUDED.procurement_id,
    price_registry_source_id = EXCLUDED.price_registry_source_id,
    agency_tax_id = EXCLUDED.agency_tax_id,
    unit_code = EXCLUDED.unit_code,
    year = EXCLUDED.year,
    sequence = EXCLUDED.sequence,
    contract_number = EXCLUDED.contract_number,
    process_number = EXCLUDED.process_number,
    type_id = EXCLUDED.type_id,
    type_name = EXCLUDED.type_name,
    category_id = EXCLUDED.category_id,
    category_name = EXCLUDED.category_name,
    supplier_tax_id = EXCLUDED.supplier_tax_id,
    supplier_name = EXCLUDED.supplier_name,
    supplier_kind = EXCLUDED.supplier_kind,
    supplier_country_code = EXCLUDED.supplier_country_code,
    subcontractor_tax_id = EXCLUDED.subcontractor_tax_id,
    subcontractor_name = EXCLUDED.subcontractor_name,
    description = EXCLUDED.description,
    additional_info = EXCLUDED.additional_info,
    is_revenue = EXCLUDED.is_revenue,
    installments = EXCLUDED.installments,
    installment_value = EXCLUDED.installment_value,
    initial_value = EXCLUDED.initial_value,
    global_value = EXCLUDED.global_value,
    accumulated_value = EXCLUDED.accumulated_value,
    signed_at = EXCLUDED.signed_at,
    starts_at = EXCLUDED.starts_at,
    ends_at = EXCLUDED.ends_at,
    published_at = EXCLUDED.published_at,
    source_updated_at = EXCLUDED.source_updated_at,
    source_global_updated_at = EXCLUDED.source_global_updated_at,
    from_price_registry = EXCLUDED.from_price_registry,
    parliamentary_amendment = EXCLUDED.parliamentary_amendment,
    origin_system = EXCLUDED.origin_system,
    updated_at = now()
WHERE contracts.source_global_updated_at IS NULL
   OR EXCLUDED.source_global_updated_at IS NULL
   OR EXCLUDED.source_global_updated_at > contracts.source_global_updated_at
"""

_UPSERT_SOURCE_PAYLOAD_SQL = """
INSERT INTO source_payloads (source, entity_type, external_id, payload, fetched_at)
VALUES (%(source)s, %(entity_type)s, %(external_id)s, %(payload)s, now())
ON CONFLICT (source, entity_type, external_id) DO UPDATE SET
    payload = EXCLUDED.payload,
    fetched_at = now()
"""

_SELECT_PENDING_AMENDMENTS_SQL = """
SELECT id, source_id, agency_tax_id, year, sequence
FROM contracts
WHERE amendments_synced_at IS NULL
ORDER BY id
"""

_DELETE_AMENDMENTS_SQL = "DELETE FROM contract_amendments WHERE contract_id = %s"

_INSERT_AMENDMENT_SQL = """
INSERT INTO contract_amendments (
    contract_id, sequence, number, type_name, description, legal_basis, notes,
    qualifiers, value_added, installments, installment_value, global_value,
    extended_days, supplier_tax_id, supplier_name, signed_at, starts_at, ends_at,
    published_at, source_created_at, source_updated_at
) VALUES (
    %(contract_id)s, %(sequence)s, %(number)s, %(type_name)s, %(description)s, %(legal_basis)s,
    %(notes)s,
    %(qualifiers)s, %(value_added)s, %(installments)s, %(installment_value)s, %(global_value)s,
    %(extended_days)s, %(supplier_tax_id)s, %(supplier_name)s, %(signed_at)s, %(starts_at)s,
    %(ends_at)s,
    %(published_at)s, %(source_created_at)s, %(source_updated_at)s
)
"""

_STAMP_AMENDMENTS_SYNCED_SQL = """
UPDATE contracts SET amendments_synced_at = now(), updated_at = now() WHERE id = %s
"""


# ---------------------------------------------------------------- DTO mapping


def row_from_contract_dto(dto: dict[str, Any]) -> dict[str, Any]:
    """Flatten one `RecuperarContratoDTO` into `contracts` row params.

    Nested `orgaoEntidade`/`unidadeOrgao`/`tipoContrato`/`categoriaProcesso`
    objects are flattened here (and separately fed to `upsert_agency`/
    `upsert_agency_unit`); the complete DTO is preserved verbatim in
    `source_payloads` by `upsert_contract`, not inline on this row.
    """
    agency = dto.get("orgaoEntidade") or {}
    unit = dto.get("unidadeOrgao") or {}
    contract_type = dto.get("tipoContrato") or {}
    category = dto.get("categoriaProcesso") or {}

    return {
        "source": "pncp",
        "source_id": dto["numeroControlePNCP"],
        "procurement_source_id": dto.get("numeroControlePncpCompra"),
        "price_registry_source_id": dto.get("numeroControlePncpAta"),
        "agency_tax_id": agency.get("cnpj"),
        "unit_code": unit.get("codigoUnidade"),
        "year": dto.get("anoContrato"),
        "sequence": dto.get("sequencialContrato"),
        "contract_number": dto.get("numeroContratoEmpenho"),
        "process_number": dto.get("processo"),
        "type_id": contract_type.get("id"),
        "type_name": contract_type.get("nome"),
        "category_id": category.get("id"),
        "category_name": category.get("nome"),
        "supplier_tax_id": dto.get("niFornecedor"),
        "supplier_name": dto.get("nomeRazaoSocialFornecedor"),
        "supplier_kind": dto.get("tipoPessoa"),
        "supplier_country_code": dto.get("codigoPaisFornecedor"),
        "subcontractor_tax_id": dto.get("niFornecedorSubContratado"),
        "subcontractor_name": dto.get("nomeFornecedorSubContratado"),
        "description": dto.get("objetoContrato"),
        "additional_info": dto.get("informacaoComplementar"),
        "is_revenue": dto.get("receita"),
        "installments": dto.get("numeroParcelas"),
        "installment_value": dto.get("valorParcela"),
        "initial_value": dto.get("valorInicial"),
        "global_value": dto.get("valorGlobal"),
        "accumulated_value": dto.get("valorAcumulado"),
        "signed_at": dto.get("dataAssinatura"),
        "starts_at": dto.get("dataVigenciaInicio"),
        "ends_at": dto.get("dataVigenciaFim"),
        "published_at": dto.get("dataPublicacaoPncp"),
        "source_updated_at": dto.get("dataAtualizacao"),
        "source_global_updated_at": dto.get("dataAtualizacaoGlobal"),
        "from_price_registry": dto.get("frutoAdesao"),
        "parliamentary_amendment": dto.get("emendaParlamentar"),
        "origin_system": dto.get("usuarioNome"),
    }


def row_from_amendment_dto(contract_id: int, dto: dict[str, Any]) -> dict[str, Any]:
    """Flatten one `RecuperarTermoContratoDTO` into `contract_amendments` row
    params. The four `qualificacao*` booleans/flags are nested into the
    `qualifiers` JSON column verbatim (no normalization — they are opaque
    flags PNCP doesn't further explain)."""
    return {
        "contract_id": contract_id,
        "sequence": dto["sequencialTermoContrato"],
        "number": dto.get("numeroTermoContrato"),
        "type_name": dto.get("tipoTermoContratoNome"),
        "description": dto.get("objetoTermoContrato"),
        "legal_basis": dto.get("fundamentoLegal"),
        "notes": dto.get("informativoObservacao"),
        "qualifiers": Json(
            {
                "added_or_removed": dto.get("qualificacaoAcrescimoSupressao"),
                "term": dto.get("qualificacaoVigencia"),
                "supplier": dto.get("qualificacaoFornecedor"),
                "readjustment": dto.get("qualificacaoReajuste"),
                "informative": dto.get("informativoObservacao"),
            }
        ),
        "value_added": dto.get("valorAcrescido"),
        "installments": dto.get("numeroParcelas"),
        "installment_value": dto.get("valorParcela"),
        "global_value": dto.get("valorGlobal"),
        "extended_days": dto.get("prazoAditadoDias"),
        "supplier_tax_id": dto.get("niFornecedor"),
        "supplier_name": dto.get("nomeRazaoSocialFornecedor"),
        "signed_at": dto.get("dataAssinatura"),
        "starts_at": dto.get("dataVigenciaInicio"),
        "ends_at": dto.get("dataVigenciaFim"),
        "published_at": dto.get("dataPublicacaoPncp"),
        "source_created_at": dto.get("dataInclusao"),
        "source_updated_at": dto.get("dataAtualizacao"),
    }


# ---------------------------------------------------------------- writers


def upsert_agency(cursor: psycopg.Cursor, orgao: dict[str, Any]) -> str | None:
    """Upsert one `orgaoEntidade`. Returns its `cnpj`, or None if absent."""
    tax_id = orgao.get("cnpj")
    if not tax_id:
        return None
    cursor.execute(
        _UPSERT_AGENCY_SQL,
        {
            "tax_id": tax_id,
            "name": orgao.get("razaoSocial"),
            "power_code": orgao.get("poderId"),
            "sphere_code": orgao.get("esferaId"),
        },
    )
    return tax_id


def upsert_agency_unit(cursor: psycopg.Cursor, agency_tax_id: str, unidade: dict[str, Any]) -> None:
    """Upsert one `unidadeOrgao`. No-op when it has no `codigoUnidade`
    (the agency_units primary key requires one)."""
    code = unidade.get("codigoUnidade")
    if not code:
        return
    cursor.execute(
        _UPSERT_AGENCY_UNIT_SQL,
        {
            "agency_tax_id": agency_tax_id,
            "code": code,
            "name": unidade.get("nomeUnidade"),
            "state": unidade.get("ufSigla"),
            "city_name": unidade.get("municipioNome"),
            "ibge_code": unidade.get("codigoIbge"),
        },
    )


def resolve_procurement_id(cursor: psycopg.Cursor, procurement_source_id: str | None) -> int | None:
    """`SELECT id FROM procurements WHERE source='pncp' AND source_id =
    procurement_source_id` — NULL (no query at all) when
    `procurement_source_id` itself is absent, NULL (query, no row) when the
    procurement hasn't been synced yet."""
    if not procurement_source_id:
        return None
    cursor.execute(
        "SELECT id FROM procurements WHERE source = 'pncp' AND source_id = %s",
        (procurement_source_id,),
    )
    row = cursor.fetchone()
    return row[0] if row else None


def upsert_contract(cursor: psycopg.Cursor, dto: dict[str, Any]) -> None:
    """Upsert the agency, its unit, the contract row (freshness-guarded on
    `source_global_updated_at`, `procurement_id` resolved fresh every time),
    and the raw payload — in that order, since the contract row
    FK-references the agency."""
    agency_tax_id = upsert_agency(cursor, dto.get("orgaoEntidade") or {})
    if agency_tax_id:
        upsert_agency_unit(cursor, agency_tax_id, dto.get("unidadeOrgao") or {})

    row = row_from_contract_dto(dto)
    row["procurement_id"] = resolve_procurement_id(cursor, row["procurement_source_id"])
    cursor.execute(_UPSERT_CONTRACT_SQL, row)
    cursor.execute(
        _UPSERT_SOURCE_PAYLOAD_SQL,
        {
            "source": "pncp",
            "entity_type": "contract",
            "external_id": row["source_id"],
            "payload": Json(dto),
        },
    )


# ---------------------------------------------------------------- watermark


def _get_watermark(conn: psycopg.Connection) -> str | None:
    with conn.cursor() as cur:
        cur.execute("SELECT value ->> 'watermark' FROM sync_state WHERE key = %s", (WATERMARK_KEY,))
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
            {"key": WATERMARK_KEY, "value": Json({"watermark": watermark})},
        )
    conn.commit()


def _bootstrap_start_date(conn: psycopg.Connection) -> date:
    """First-ever-run fallback: the newest `source_global_updated_at`
    already in `contracts` (in case some were written by another process),
    else today."""
    with conn.cursor() as cur:
        cur.execute("SELECT max(source_global_updated_at) FROM contracts")
        row = cur.fetchone()
    newest = row[0] if row else None
    return newest.date() if newest is not None else datetime.now(UTC).date()


def _resolve_window_start(
    existing_watermark: str | None, since: date | None, bootstrap_date: date
) -> date:
    if existing_watermark is not None:
        return datetime.fromisoformat(existing_watermark).date()
    if since is not None:
        return since
    return bootstrap_date


def _iter_date_chunks(
    start: date, end: date, chunk_days: int = CHUNK_DAYS
) -> Iterator[tuple[date, date]]:
    """Yield `(chunk_start, chunk_end)` inclusive date pairs covering
    `[start, end]`, each spanning at most `chunk_days` days."""
    current = start
    while current <= end:
        chunk_end = min(current + timedelta(days=chunk_days - 1), end)
        yield current, chunk_end
        current = chunk_end + timedelta(days=1)


# ---------------------------------------------------------------- phase 1: contracts


def sync_contracts(
    conn: psycopg.Connection,
    *,
    since: date | None = None,
    until: date | None = None,
    client: PncpClient | None = None,
    counters: RunCounters | None = None,
) -> dict[str, Any]:
    """Page `/v1/contratos/atualizacao` from the watermark (or `--since`, or
    the newest `source_global_updated_at` already in `contracts`) to
    `until` (default today), upserting every contract seen.

    The window is walked in `CHUNK_DAYS`-day slices; the watermark advances
    once, at the end of the run, to the max `dataAtualizacaoGlobal` seen
    across every slice — or to `until` if zero rows were seen, so a quiet
    run still moves the window forward instead of re-scanning a widening
    range next time. Left untouched (no-op) when the resolved window start
    is after `until` (e.g. a `--since` in the future).
    """
    counters = counters if counters is not None else RunCounters()
    until = until or datetime.now(tz=UTC).date()

    existing_watermark = _get_watermark(conn)
    bootstrap_date = _bootstrap_start_date(conn)
    window_start = _resolve_window_start(existing_watermark, since, bootstrap_date)

    if window_start > until:
        logger.info(
            "contracts: window start %s is after until %s, nothing to do",
            window_start,
            until,
        )
        return {"rows_seen": 0, "watermark": existing_watermark}

    owns_client = client is None
    client = client or PncpClient()

    seen_max: str | None = None
    rows_seen = 0

    try:
        for chunk_start, chunk_end in _iter_date_chunks(window_start, until):
            page = 1
            while True:
                body = client.fetch_contracts_page(
                    date_from=chunk_start.strftime("%Y%m%d"),
                    date_to=chunk_end.strftime("%Y%m%d"),
                    page=page,
                    updated=True,
                )
                data = body.get("data", [])
                if data:
                    with conn.cursor() as cur:
                        for dto in data:
                            upsert_contract(cur, dto)
                            rows_seen += 1
                            counters.inc("contracts")
                            dto_watermark = dto.get("dataAtualizacaoGlobal")
                            if dto_watermark and (seen_max is None or dto_watermark > seen_max):
                                seen_max = dto_watermark
                    conn.commit()

                if body.get("paginasRestantes", 0) <= 0:
                    break
                page += 1
    finally:
        if owns_client:
            client.close()

    new_watermark = seen_max or existing_watermark or f"{until.isoformat()}T00:00:00"
    _advance_watermark(conn, new_watermark)
    logger.info("contracts: %d row(s) seen, watermark -> %s", rows_seen, new_watermark)

    return {"rows_seen": rows_seen, "watermark": new_watermark}


# ---------------------------------------------------------------- phase 2: amendments


def _select_pending_amendments(
    conn: psycopg.Connection, *, limit: int | None
) -> list[tuple[int, str, str, int, int]]:
    sql = _SELECT_PENDING_AMENDMENTS_SQL
    params: dict[str, Any] = {}
    if limit is not None:
        sql += " LIMIT %(limit)s"
        params["limit"] = limit
    with conn.cursor() as cur:
        cur.execute(sql, params)
        return cur.fetchall()


def sync_amendments(
    conn: psycopg.Connection,
    *,
    limit: int | None = None,
    client: PncpClient | None = None,
    counters: RunCounters | None = None,
) -> dict[str, Any]:
    """Drain `/termos` for contracts with `amendments_synced_at IS NULL`,
    oldest `id` first, up to `limit` contracts.

    Each contract's amendments are replaced wholesale (DELETE then INSERT)
    and `amendments_synced_at` is stamped even when the array is empty — a
    valid "checked, has none" outcome, not "never checked". One contract
    failing after retries is logged and skipped, not fatal to the run.
    """
    counters = counters if counters is not None else RunCounters()
    owns_client = client is None
    client = client or PncpClient()

    pending = _select_pending_amendments(conn, limit=limit)

    processed = 0
    total_amendments = 0
    try:
        for contract_id, source_id, agency_tax_id, year, sequence in pending:
            try:
                amendments = client.fetch_contract_amendments(
                    agency_tax_id=agency_tax_id,
                    year=year,
                    sequence=sequence,
                )
            except PncpApiError:
                logger.exception(
                    "contract %s: amendments fetch failed after retries, skipping", source_id
                )
                counters.inc("errors")
                continue

            with conn.cursor() as cur:
                cur.execute(_DELETE_AMENDMENTS_SQL, (contract_id,))
                for dto in amendments:
                    cur.execute(_INSERT_AMENDMENT_SQL, row_from_amendment_dto(contract_id, dto))
                cur.execute(
                    _UPSERT_SOURCE_PAYLOAD_SQL,
                    {
                        "source": "pncp",
                        "entity_type": "contract_amendments",
                        "external_id": source_id,
                        "payload": Json(amendments),
                    },
                )
                cur.execute(_STAMP_AMENDMENTS_SYNCED_SQL, (contract_id,))
            conn.commit()

            processed += 1
            total_amendments += len(amendments)
            counters.inc("contracts_processed")
            counters.inc("amendments", len(amendments))
            logger.info("contract %s: %d amendment(s)", source_id, len(amendments))
    finally:
        if owns_client:
            client.close()

    return {"processed": processed, "amendments": total_amendments}
