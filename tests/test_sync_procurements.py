"""Unit tests for src/lixto/sync/procurements.py (and the shared upserts in
src/lixto/sync/__init__.py).

No network, no live database: DTOs are built inline in the shape PNCP
returns (docs/PNCP_API.md) and psycopg cursors/connections are MagicMocks.
"""

from datetime import date
from unittest.mock import MagicMock, call

from lixto.sync import normalize_tax_id, upsert_agency, upsert_buyer_from_dto
from lixto.sync.procurements import (
    _UPSERT_SQL,
    ALL_MODALITIES,
    row_from_procurement_dto,
    sync_publications,
    upsert_procurement,
)


def _dto(**overrides) -> dict:
    dto = {
        "numeroControlePNCP": "00360305000104-1-000052/2026",
        "anoCompra": 2026,
        "sequencialCompra": 52,
        "numeroCompra": "90052/2026",
        "processo": "1234/2026",
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
        "modoDisputaId": 1,
        "modoDisputaNome": "Aberto",
        "situacaoCompraId": 1,
        "situacaoCompraNome": "Divulgada no PNCP",
        "tipoInstrumentoConvocatorioCodigo": 1,
        "tipoInstrumentoConvocatorioNome": "Edital",
        "amparoLegal": {"codigo": 1, "nome": "Lei 14.133/2021, Art. 28, I"},
        "objetoCompra": "Aquisição de material hospitalar",
        "informacaoComplementar": "Ampla concorrência",
        "srp": True,
        "valorTotalEstimado": 150000.5,
        "valorTotalHomologado": None,
        "dataAberturaProposta": "2026-08-20T09:00:00",
        "dataEncerramentoProposta": "2026-08-30T09:00:00",
        "dataPublicacaoPncp": "2026-08-19T14:00:00",
        "dataInclusao": "2026-08-19T13:55:00",
        "dataAtualizacao": "2026-08-19T14:00:00",
        "dataAtualizacaoGlobal": "2026-08-19T14:05:00",
        "linkSistemaOrigem": "https://portal.example/edital/1",
        "linkProcessoEletronico": "https://portal.example/processo/1",
        "fontesOrcamentarias": [{"codigo": 1, "nome": "Tesouro"}],
        "usuarioNome": "Portal de Compras Publicas",
    }
    dto.update(overrides)
    return dto


def _page(dtos, *, total=None, pages_left=0):
    return {
        "data": dtos,
        "totalRegistros": total if total is not None else len(dtos),
        "totalPaginas": 1,
        "numeroPagina": 1,
        "paginasRestantes": pages_left,
        "empty": not dtos,
    }


# --- tax id / buyer upserts ------------------------------------------------


def test_normalize_tax_id_strips_punctuation_and_pads():
    assert normalize_tax_id("00.360.305/0001-04") == "00360305000104"
    assert normalize_tax_id("360305000104") == "00360305000104"
    assert normalize_tax_id(None) is None
    assert normalize_tax_id("123456789012345678") is None


def test_upsert_agency_falls_back_to_tax_id_when_name_missing():
    cursor = MagicMock()

    tax_id = upsert_agency(cursor, tax_id="00360305000104", name=None)

    assert tax_id == "00360305000104"
    params = cursor.execute.call_args.args[1]
    assert params["name"] == "00360305000104"


def test_upsert_buyer_from_dto_writes_agency_then_unit():
    cursor = MagicMock()

    agency_tax_id, unit_code = upsert_buyer_from_dto(cursor, _dto())

    assert agency_tax_id == "00360305000104"
    assert unit_code == "925467"
    sqls = [c.args[0] for c in cursor.execute.call_args_list]
    assert "INSERT INTO agencies" in sqls[0]
    assert "INSERT INTO agency_units" in sqls[1]
    unit_params = cursor.execute.call_args_list[1].args[1]
    assert unit_params["state"] == "SP"
    assert unit_params["city_name"] == "Campinas"
    assert unit_params["ibge_code"] == "3509502"


def test_upsert_buyer_from_dto_without_cnpj_returns_none():
    cursor = MagicMock()

    assert upsert_buyer_from_dto(cursor, {"numeroControlePNCP": "x"}) == (None, None)
    cursor.execute.assert_not_called()


# --- row mapping -----------------------------------------------------------


def test_row_from_procurement_dto_maps_adr_columns():
    dto = _dto()

    row = row_from_procurement_dto(dto, agency_tax_id="00360305000104", unit_code="925467")

    assert row["source"] == "pncp"
    assert row["source_id"] == dto["numeroControlePNCP"]
    assert row["agency_tax_id"] == "00360305000104"
    assert row["unit_code"] == "925467"
    assert row["state"] == "SP"
    assert row["city_name"] == "Campinas"
    assert row["year"] == 2026
    assert row["sequence"] == 52
    assert row["modality_id"] == 6
    assert row["instrument_type_id"] == 1
    assert row["legal_basis_code"] == "1"
    assert row["legal_basis_name"] == dto["amparoLegal"]["nome"]
    assert row["description"] == dto["objetoCompra"]
    assert row["is_price_registry"] is True
    assert row["estimated_value"] == 150000.5
    assert row["proposal_closes_at"] == dto["dataEncerramentoProposta"]
    assert row["source_global_updated_at"] == dto["dataAtualizacaoGlobal"]
    assert row["origin_system"] == dto["usuarioNome"]
    assert row["origin_url"] == dto["linkSistemaOrigem"]
    assert row["process_url"] == dto["linkProcessoEletronico"]
    assert row["budget_sources"].obj == dto["fontesOrcamentarias"]


def test_row_from_procurement_dto_handles_missing_optional_fields():
    dto = {
        "numeroControlePNCP": "00000000000000-1-000001/2026",
        "modalidadeId": 8,
        "dataAberturaProposta": None,
        "dataEncerramentoProposta": None,
        "dataAtualizacaoGlobal": "2026-01-02T10:00:00",
    }

    row = row_from_procurement_dto(dto, agency_tax_id="00000000000000", unit_code=None)

    assert row["proposal_opens_at"] is None
    assert row["proposal_closes_at"] is None
    assert row["state"] is None
    assert row["legal_basis_code"] is None
    assert row["budget_sources"].obj == []


# --- upsert ---------------------------------------------------------------


def test_upsert_procurement_writes_buyer_then_procurement_then_payload():
    cursor = MagicMock()
    dto = _dto()

    upsert_procurement(cursor, dto)

    sqls = [c.args[0] for c in cursor.execute.call_args_list]
    assert len(sqls) == 4
    assert "INSERT INTO agencies" in sqls[0]
    assert "INSERT INTO agency_units" in sqls[1]
    assert sqls[2] is _UPSERT_SQL
    assert "INSERT INTO source_payloads" in sqls[3]

    payload_params = cursor.execute.call_args_list[3].args[1]
    assert payload_params["entity_type"] == "procurement"
    assert payload_params["external_id"] == dto["numeroControlePNCP"]
    assert payload_params["payload"].obj == dto


def test_upsert_procurement_sql_is_freshness_guarded_and_resets_detail_stamps():
    assert "ON CONFLICT (source, source_id) DO UPDATE" in _UPSERT_SQL
    assert (
        "WHERE EXCLUDED.source_global_updated_at > procurements.source_global_updated_at"
        in _UPSERT_SQL
    )
    assert "items_synced_at = NULL" in _UPSERT_SQL
    assert "documents_synced_at = NULL" in _UPSERT_SQL


def test_upsert_procurement_returns_none_and_skips_when_agency_missing():
    cursor = MagicMock()

    assert upsert_procurement(cursor, {"numeroControlePNCP": "ctrl-1"}) is None
    cursor.execute.assert_not_called()


def test_upsert_procurement_returns_id_when_row_written():
    cursor = MagicMock()
    cursor.fetchone.return_value = (42,)

    assert upsert_procurement(cursor, _dto()) == 42


def test_upsert_procurement_returns_none_when_guard_skipped_the_row():
    cursor = MagicMock()
    cursor.fetchone.return_value = None

    assert upsert_procurement(cursor, _dto()) is None


# --- sync_publications ----------------------------------------------------


def _mock_conn():
    cursor = MagicMock()
    cursor.fetchone.return_value = (1,)
    conn = MagicMock()
    conn.cursor.return_value.__enter__.return_value = cursor
    conn.cursor.return_value.__exit__.return_value = False
    return conn, cursor


def test_sync_publications_pages_one_modality_and_upserts_rows():
    conn, cursor = _mock_conn()
    fake_client = MagicMock()
    fake_client.iter_publication_pages.return_value = [_page([_dto(), _dto()], total=2)]

    totals = sync_publications(
        conn,
        date_from=date(2026, 1, 2),
        date_to=date(2026, 1, 2),
        modalities=[6],
        client=fake_client,
    )

    assert totals == {6: 2}
    # 2 DTOs x (agency + unit + procurement + payload)
    assert cursor.execute.call_count == 8
    fake_client.iter_publication_pages.assert_called_once_with(
        date_from="20260102", date_to="20260102", modality_id=6
    )
    conn.commit.assert_called()
    fake_client.close.assert_not_called()


def test_sync_publications_counts_rows_into_run_counters():
    conn, _cursor = _mock_conn()
    counters = MagicMock()
    fake_client = MagicMock()
    fake_client.iter_publication_pages.return_value = [_page([_dto()])]

    sync_publications(
        conn,
        date_from=date(2026, 1, 2),
        date_to=date(2026, 1, 2),
        modalities=[6],
        client=fake_client,
        counters=counters,
    )

    assert call("procurements_seen", 1) in counters.inc.call_args_list


def test_sync_publications_defaults_to_all_13_modalities():
    conn, _cursor = _mock_conn()
    fake_client = MagicMock()
    fake_client.iter_publication_pages.return_value = [_page([])]

    totals = sync_publications(
        conn, date_from=date(2026, 1, 2), date_to=date(2026, 1, 2), client=fake_client
    )

    assert sorted(totals.keys()) == ALL_MODALITIES == list(range(1, 14))
    assert fake_client.iter_publication_pages.call_count == 13
