"""PNCP sync package — one module per domain, plus the upserts they share.

`lixto.sync` itself holds only what *every* ingested domain needs:

- the buyer tables (`agencies`, `agency_units`), referenced by `procurements`,
  `procurement_plans` and `contracts` alike — always upserted **before** the
  entity that FKs to them;
- `source_payloads`, the raw-DTO retention table (ADR 001 §D2), so any entity
  can be reprocessed without re-fetching PNCP.

Later domain tickets (results, plans, contracts) import `upsert_agency`,
`upsert_agency_unit`, `upsert_buyer_from_dto` and `upsert_source_payload` from
here rather than re-implementing them; only the entity-specific upsert belongs
in the domain module.
"""

from __future__ import annotations

import logging
import re
from typing import Any

import psycopg
from psycopg.types.json import Json

logger = logging.getLogger(__name__)

SOURCE_PNCP = "pncp"

TAX_ID_LENGTH = 14

_NON_DIGITS = re.compile(r"\D")

_UPSERT_AGENCY_SQL = """
INSERT INTO agencies (tax_id, name, power_code, sphere_code)
VALUES (%(tax_id)s, %(name_insert)s, %(power_code)s, %(sphere_code)s)
ON CONFLICT (tax_id) DO UPDATE SET
    name = COALESCE(%(name_update)s, agencies.name),
    power_code = COALESCE(EXCLUDED.power_code, agencies.power_code),
    sphere_code = COALESCE(EXCLUDED.sphere_code, agencies.sphere_code),
    updated_at = now()
"""

_UPSERT_AGENCY_UNIT_SQL = """
INSERT INTO agency_units (agency_tax_id, code, name, state, city_name, ibge_code)
VALUES (%(agency_tax_id)s, %(code)s, %(name)s, %(state)s, %(city_name)s, %(ibge_code)s)
ON CONFLICT (agency_tax_id, code) DO UPDATE SET
    name = COALESCE(EXCLUDED.name, agency_units.name),
    state = COALESCE(EXCLUDED.state, agency_units.state),
    city_name = COALESCE(EXCLUDED.city_name, agency_units.city_name),
    ibge_code = COALESCE(EXCLUDED.ibge_code, agency_units.ibge_code),
    updated_at = now()
"""

_UPSERT_SOURCE_PAYLOAD_SQL = """
INSERT INTO source_payloads (source, entity_type, external_id, payload)
VALUES (%(source)s, %(entity_type)s, %(external_id)s, %(payload)s)
ON CONFLICT (source, entity_type, external_id) DO UPDATE SET
    payload = EXCLUDED.payload,
    fetched_at = now()
"""


def digits_only(value: Any) -> str | None:
    """Strip every non-digit from `value` (`None`/empty → `None`)."""
    if value is None:
        return None
    digits = _NON_DIGITS.sub("", str(value))
    return digits or None


def normalize_tax_id(value: Any) -> str | None:
    """Normalize a CNPJ to the `CHAR(14)` digits-only form used as PK.

    PNCP sends CNPJs already unpunctuated, but a leading zero is occasionally
    lost upstream (int round-trip), so short values are left-padded. Anything
    longer than 14 digits is not a CNPJ and is rejected (`None`) — the caller
    skips the row rather than writing a corrupt FK.
    """
    digits = digits_only(value)
    if digits is None:
        return None
    if len(digits) > TAX_ID_LENGTH:
        logger.warning("ignoring tax_id with %d digits: %r", len(digits), value)
        return None
    return digits.rjust(TAX_ID_LENGTH, "0")


def upsert_agency(
    cursor: psycopg.Cursor,
    *,
    tax_id: Any,
    name: str | None,
    power_code: str | None = None,
    sphere_code: str | None = None,
) -> str | None:
    """Upsert one `agencies` row; returns the normalized `tax_id` (or `None`).

    `agencies.name` is NOT NULL, so a nameless DTO inserts the tax id as a
    placeholder name; on conflict a nameless DTO never overwrites a stored
    name (the fallback is applied only in the INSERT branch).
    """
    normalized = normalize_tax_id(tax_id)
    if normalized is None:
        return None
    cursor.execute(
        _UPSERT_AGENCY_SQL,
        {
            "tax_id": normalized,
            "name_insert": name or normalized,
            "name_update": name or None,
            "power_code": power_code,
            "sphere_code": sphere_code,
        },
    )
    return normalized


def upsert_agency_unit(
    cursor: psycopg.Cursor,
    *,
    agency_tax_id: str,
    code: Any,
    name: str | None = None,
    state: str | None = None,
    city_name: str | None = None,
    ibge_code: Any = None,
) -> str | None:
    """Upsert one `agency_units` row; returns its `code` (or `None`).

    Must run after `upsert_agency` for the same `agency_tax_id` (FK).
    """
    if code is None or agency_tax_id is None:
        return None
    unit_code = str(code)
    cursor.execute(
        _UPSERT_AGENCY_UNIT_SQL,
        {
            "agency_tax_id": agency_tax_id,
            "code": unit_code,
            "name": name,
            "state": state,
            "city_name": city_name,
            "ibge_code": str(ibge_code) if ibge_code is not None else None,
        },
    )
    return unit_code


def upsert_buyer_from_dto(
    cursor: psycopg.Cursor, dto: dict[str, Any]
) -> tuple[str | None, str | None]:
    """Upsert the `orgaoEntidade`/`unidadeOrgao` of a PNCP DTO.

    Returns `(agency_tax_id, unit_code)` for the caller to write on the
    entity row; `(None, None)` when the DTO carries no usable CNPJ (the
    entity cannot be stored — `agency_tax_id` is NOT NULL everywhere).
    """
    agency = dto.get("orgaoEntidade") or {}
    unit = dto.get("unidadeOrgao") or {}

    agency_tax_id = upsert_agency(
        cursor,
        tax_id=agency.get("cnpj"),
        name=agency.get("razaoSocial"),
        power_code=agency.get("poderId"),
        sphere_code=agency.get("esferaId"),
    )
    if agency_tax_id is None:
        return None, None

    unit_code = upsert_agency_unit(
        cursor,
        agency_tax_id=agency_tax_id,
        code=unit.get("codigoUnidade"),
        name=unit.get("nomeUnidade"),
        state=unit.get("ufSigla"),
        city_name=unit.get("municipioNome"),
        ibge_code=unit.get("codigoIbge"),
    )
    return agency_tax_id, unit_code


def upsert_source_payload(
    cursor: psycopg.Cursor,
    *,
    entity_type: str,
    external_id: str,
    payload: Any,
    source: str = SOURCE_PNCP,
) -> None:
    """Retain one raw DTO (or the complete array of a list endpoint).

    `entity_type` is one of the values allowed by the table's CHECK
    ('procurement', 'procurement_items', 'procurement_documents',
    'procurement_results', 'procurement_plan', 'contract',
    'contract_amendments'); `external_id` is the entity's `source_id`.
    """
    cursor.execute(
        _UPSERT_SOURCE_PAYLOAD_SQL,
        {
            "source": source,
            "entity_type": entity_type,
            "external_id": external_id,
            "payload": Json(payload),
        },
    )
