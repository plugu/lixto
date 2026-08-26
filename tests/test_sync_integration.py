"""DDL-backed integration tests for the sync upserts.

Everything else under `tests/` mocks psycopg, which is exactly why the
cycle-18 reviewer findings survived a green suite: a mock happily accepts an
INSERT that Postgres rejects with `null value in column "agency_tax_id"
violates not-null constraint`. These tests run the real upserts against a
scratch database built from `migrations/001_core.sql` (fixtures in
`tests/conftest.py`), so a DTO that would abort a live run fails here.

Skipped — not failed — when no Postgres is reachable; run it locally with
`docker compose up -d db`.
"""

from __future__ import annotations

from typing import Any

import psycopg
import pytest

from lixto.runs import RunCounters
from lixto.sync import upsert_agency
from lixto.sync.contracts import upsert_contract
from lixto.sync.plans import upsert_plan
from lixto.sync.procurements import upsert_procurement

pytestmark = pytest.mark.usefixtures("migrated_database_url")


# ------------------------------------------------------------------- helpers


def _procurement_dto(**overrides: Any) -> dict[str, Any]:
    dto: dict[str, Any] = {
        "numeroControlePNCP": "00360305000104-1-000052/2026",
        "anoCompra": 2026,
        "sequencialCompra": 52,
        "numeroCompra": "90052/2026",
        "orgaoEntidade": {
            "cnpj": "00360305000104",
            "razaoSocial": "MUNICIPIO DE EXEMPLO",
            "poderId": "E",
            "esferaId": "M",
        },
        "unidadeOrgao": {
            "codigoUnidade": "925467",
            "nomeUnidade": "SECRETARIA DE SAUDE",
            "ufSigla": "SP",
            "municipioNome": "Campinas",
            "codigoIbge": "3509502",
        },
        "modalidadeId": 6,
        "modalidadeNome": "Pregão - Eletrônico",
        "objetoCompra": "Aquisição de luvas",
        "valorTotalEstimado": 1000.0,
        "dataPublicacaoPncp": "2026-01-10T10:00:00",
        "dataAtualizacaoGlobal": None,
    }
    dto.update(overrides)
    return dto


def _contract_dto(**overrides: Any) -> dict[str, Any]:
    dto: dict[str, Any] = {
        "numeroControlePNCP": "00360305000104-2-000017/2026",
        "numeroControlePncpCompra": "00360305000104-1-000052/2026",
        "orgaoEntidade": {
            "cnpj": "00360305000104",
            "razaoSocial": "MUNICIPIO DE EXEMPLO",
            "poderId": "E",
            "esferaId": "M",
        },
        "unidadeOrgao": {"codigoUnidade": "925467", "nomeUnidade": "SECRETARIA DE SAUDE"},
        "anoContrato": 2026,
        "sequencialContrato": 17,
        "objetoContrato": "Fornecimento de luvas",
        "valorGlobal": 12000.0,
        "dataAtualizacaoGlobal": "2026-01-11T10:00:00",
    }
    dto.update(overrides)
    return dto


def _plan_dto(**overrides: Any) -> dict[str, Any]:
    dto: dict[str, Any] = {
        "idPcaPncp": "00360305000104-0-000001/2026",
        "orgaoEntidadeCnpj": "00.360.305/0001-04",
        "orgaoEntidadeRazaoSocial": "MUNICIPIO DE EXEMPLO",
        "codigoUnidade": "925467",
        "nomeUnidade": "SECRETARIA DE SAUDE",
        "anoPca": 2026,
        "dataPublicacaoPNCP": "2026-01-15T10:00:00",
        "dataAtualizacaoGlobalPCA": "2026-08-20T09:30:00",
        "itens": [{"numeroItem": 1, "descricaoItem": "Luva", "valorTotal": 100.0}],
    }
    dto.update(overrides)
    return dto


def _scalar(conn: psycopg.Connection, sql: str, params: tuple[Any, ...] = ()) -> Any:
    with conn.cursor() as cur:
        cur.execute(sql, params)
        row = cur.fetchone()
    return row[0] if row else None


# ------------------------------------------------------------------ agencies


def test_agency_without_a_name_is_storable_and_later_named(db_conn):
    # `agencies.name` is NOT NULL: a bare `VALUES (tax_id, NULL)` raises and
    # aborts the run, so the shared helper falls back to the tax id — which a
    # later fetch carrying `razaoSocial` replaces.
    with db_conn.cursor() as cur:
        assert upsert_agency(cur, tax_id="00360305000104", name=None) == "00360305000104"
    db_conn.commit()
    assert _scalar(db_conn, "SELECT name FROM agencies") == "00360305000104"

    with db_conn.cursor() as cur:
        upsert_agency(cur, tax_id="00360305000104", name="MUNICIPIO DE EXEMPLO")
    db_conn.commit()

    assert _scalar(db_conn, "SELECT name FROM agencies") == "MUNICIPIO DE EXEMPLO"


def test_agency_tax_id_is_zero_padded_to_the_char14_key(db_conn):
    with db_conn.cursor() as cur:
        assert upsert_agency(cur, tax_id="360305000104", name="X") == "00360305000104"
    db_conn.commit()

    assert _scalar(db_conn, "SELECT count(*) FROM agencies WHERE tax_id = '00360305000104'") == 1


# -------------------------------------------------------------- procurements


def test_procurement_with_null_global_updated_is_updated_by_a_later_fetch(db_conn):
    # `NULL > x` is NULL (false): with a bare `>` guard a procurement stored
    # without `dataAtualizacaoGlobal` would be frozen forever.
    with db_conn.cursor() as cur:
        first_id = upsert_procurement(cur, _procurement_dto())
    db_conn.commit()
    assert first_id is not None

    with db_conn.cursor() as cur:
        second_id = upsert_procurement(
            cur,
            _procurement_dto(
                objetoCompra="Aquisição de luvas (retificado)",
                dataAtualizacaoGlobal="2026-02-01T00:00:00",
            ),
        )
    db_conn.commit()

    assert second_id == first_id
    assert (
        _scalar(db_conn, "SELECT description FROM procurements WHERE id = %s", (first_id,))
        == "Aquisição de luvas (retificado)"
    )


def test_procurement_freshness_guard_still_skips_an_older_dto(db_conn):
    with db_conn.cursor() as cur:
        first_id = upsert_procurement(
            cur, _procurement_dto(dataAtualizacaoGlobal="2026-02-01T00:00:00")
        )
        stale = upsert_procurement(
            cur,
            _procurement_dto(objetoCompra="stale", dataAtualizacaoGlobal="2026-01-01T00:00:00"),
        )
    db_conn.commit()

    assert stale is None
    assert (
        _scalar(db_conn, "SELECT description FROM procurements WHERE id = %s", (first_id,))
        == "Aquisição de luvas"
    )


def test_procurement_without_agency_cnpj_is_skipped_not_fatal(db_conn):
    with db_conn.cursor() as cur:
        assert upsert_procurement(cur, _procurement_dto(orgaoEntidade={})) is None
    db_conn.commit()

    assert _scalar(db_conn, "SELECT count(*) FROM procurements") == 0


# ------------------------------------------------------------------ contracts


def test_contract_without_agency_cnpj_is_skipped_not_fatal(db_conn):
    counters = RunCounters()
    with db_conn.cursor() as cur:
        assert upsert_contract(cur, _contract_dto(orgaoEntidade=None), counters=counters) is False
    db_conn.commit()

    assert counters["contracts_skipped_incomplete"] == 1
    assert _scalar(db_conn, "SELECT count(*) FROM contracts") == 0


def test_contract_with_a_nameless_agency_is_stored(db_conn):
    with db_conn.cursor() as cur:
        assert upsert_contract(cur, _contract_dto(orgaoEntidade={"cnpj": "360305000104"})) is True
    db_conn.commit()

    agency_tax_id = _scalar(db_conn, "SELECT agency_tax_id FROM contracts")
    assert agency_tax_id == "00360305000104"
    assert _scalar(db_conn, "SELECT name FROM agencies WHERE tax_id = %s", (agency_tax_id,)) == (
        "00360305000104"
    )


def test_contract_update_resets_amendments_synced_at(db_conn):
    with db_conn.cursor() as cur:
        upsert_contract(cur, _contract_dto())
        cur.execute("UPDATE contracts SET amendments_synced_at = now()")
    db_conn.commit()
    assert _scalar(db_conn, "SELECT amendments_synced_at FROM contracts") is not None

    with db_conn.cursor() as cur:
        upsert_contract(cur, _contract_dto(dataAtualizacaoGlobal="2026-03-01T10:00:00"))
    db_conn.commit()

    assert _scalar(db_conn, "SELECT amendments_synced_at FROM contracts") is None


def test_contract_no_op_refetch_keeps_amendments_synced_at(db_conn):
    with db_conn.cursor() as cur:
        upsert_contract(cur, _contract_dto())
        cur.execute("UPDATE contracts SET amendments_synced_at = now()")
    db_conn.commit()

    with db_conn.cursor() as cur:
        upsert_contract(cur, _contract_dto())  # same dataAtualizacaoGlobal
    db_conn.commit()

    assert _scalar(db_conn, "SELECT amendments_synced_at FROM contracts") is not None


def test_contract_resolves_procurement_id_when_the_procurement_exists(db_conn):
    with db_conn.cursor() as cur:
        procurement_id = upsert_procurement(cur, _procurement_dto())
        upsert_contract(cur, _contract_dto())
    db_conn.commit()

    assert _scalar(db_conn, "SELECT procurement_id FROM contracts") == procurement_id


# ---------------------------------------------------------------------- plans


@pytest.mark.parametrize(
    ("overrides", "column"),
    [({"orgaoEntidadeCnpj": None}, "agency_tax_id"), ({"anoPca": None}, "year")],
)
def test_plan_missing_a_not_null_column_is_skipped_not_fatal(db_conn, overrides, column):
    counters = RunCounters()
    with db_conn.cursor() as cur:
        assert upsert_plan(cur, _plan_dto(**overrides), counters=counters) is None
    db_conn.commit()

    assert counters["plans_skipped_incomplete"] == 1, column
    assert _scalar(db_conn, "SELECT count(*) FROM procurement_plans") == 0
    # the raw DTO is still retained for reprocessing
    assert (
        _scalar(
            db_conn,
            "SELECT count(*) FROM source_payloads WHERE entity_type = 'procurement_plan'",
        )
        == 1
    )


def test_plan_with_a_nameless_agency_is_stored_and_items_replaced(db_conn):
    with db_conn.cursor() as cur:
        plan_id = upsert_plan(cur, _plan_dto(orgaoEntidadeRazaoSocial=None))
    db_conn.commit()

    assert plan_id is not None
    assert _scalar(db_conn, "SELECT agency_tax_id FROM procurement_plans") == "00360305000104"
    assert _scalar(db_conn, "SELECT name FROM agencies") == "00360305000104"
    assert _scalar(db_conn, "SELECT count(*) FROM procurement_plan_items") == 1

    with db_conn.cursor() as cur:
        upsert_plan(
            cur,
            _plan_dto(
                dataAtualizacaoGlobalPCA="2026-09-01T00:00:00",
                itens=[
                    {"numeroItem": 1, "descricaoItem": "Luva"},
                    {"numeroItem": 2, "descricaoItem": "Máscara"},
                ],
            ),
        )
    db_conn.commit()

    assert _scalar(db_conn, "SELECT count(*) FROM procurement_plan_items") == 2


def test_plan_agency_shares_the_key_with_the_procurement_agency(db_conn):
    # The plan CNPJ arrives punctuated and the procurement one does not; both
    # must land on the same CHAR(14) `agencies` row, not two.
    with db_conn.cursor() as cur:
        upsert_procurement(cur, _procurement_dto())
        upsert_plan(cur, _plan_dto())
    db_conn.commit()

    assert _scalar(db_conn, "SELECT count(*) FROM agencies") == 1
