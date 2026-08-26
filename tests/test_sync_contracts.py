"""Unit tests for src/lixto/sync/contracts.py.

Fully mocked psycopg connection/cursors and a mocked `PncpClient` — no
network, no live database, mirroring tests/lixto/test_enrich_worker.py and
tests/lixto/test_runs.py. HTTP-layer concerns (pagination, 204 handling,
retries) belong to and are covered by tests/lixto/test_pncp_client.py; here
the `PncpClient` boundary is a mock returning page/array dicts of the same
shape, including 204's empty-page dict (`data: []`, `paginasRestantes: 0`).
"""

import itertools
from datetime import date
from unittest.mock import MagicMock

from psycopg.types.json import Json

from lixto.pncp_client import PncpApiError
from lixto.runs import RunCounters
from lixto.sync.contracts import (
    _UPSERT_CONTRACT_SQL,
    CHUNK_DAYS,
    _iter_date_chunks,
    _resolve_window_start,
    resolve_procurement_id,
    row_from_amendment_dto,
    row_from_contract_dto,
    sync_amendments,
    sync_contracts,
    upsert_contract,
)

# --------------------------------------------------------------- DTO mapping


def _contract_dto(**overrides):
    dto = {
        "numeroControlePNCP": "00000000000191-2-000017/2026",
        "numeroControlePncpCompra": "00000000000191-1-000001/2026",
        "numeroControlePncpAta": None,
        "orgaoEntidade": {
            "cnpj": "00000000000191",
            "razaoSocial": "Prefeitura Municipal",
            "poderId": "E",
            "esferaId": "M",
        },
        "unidadeOrgao": {
            "codigoUnidade": "000001",
            "nomeUnidade": "Secretaria de Saúde",
            "ufSigla": "RJ",
            "municipioNome": "Rio de Janeiro",
            "codigoIbge": "3304557",
        },
        "anoContrato": 2026,
        "sequencialContrato": 17,
        "numeroContratoEmpenho": "017/2026",
        "processo": "2026/001",
        "tipoContrato": {"id": 3, "nome": "Contrato"},
        "categoriaProcesso": {"id": 1, "nome": "Materiais"},
        "niFornecedor": "11222333000144",
        "nomeRazaoSocialFornecedor": "Fornecedor LTDA",
        "tipoPessoa": "PJ",
        "codigoPaisFornecedor": "BR",
        "niFornecedorSubContratado": None,
        "nomeFornecedorSubContratado": None,
        "objetoContrato": "Aquisição de materiais hospitalares",
        "informacaoComplementar": "Entrega parcelada",
        "receita": False,
        "numeroParcelas": 12,
        "valorParcela": 1000.50,
        "valorInicial": 12000.00,
        "valorGlobal": 12000.00,
        "valorAcumulado": 1000.50,
        "dataAssinatura": "2026-01-10",
        "dataVigenciaInicio": "2026-01-15",
        "dataVigenciaFim": "2027-01-15",
        "dataPublicacaoPncp": "2026-01-11T10:00:00",
        "dataAtualizacao": "2026-01-11T10:00:00",
        "dataAtualizacaoGlobal": "2026-01-11T10:05:00",
        "frutoAdesao": True,
        "emendaParlamentar": False,
        "usuarioNome": "Sistema Origem X",
    }
    dto.update(overrides)
    return dto


def test_row_from_contract_dto_maps_nested_objects_and_booleans():
    row = row_from_contract_dto(_contract_dto())

    assert row["source"] == "pncp"
    assert row["source_id"] == "00000000000191-2-000017/2026"
    assert row["procurement_source_id"] == "00000000000191-1-000001/2026"
    assert row["agency_tax_id"] == "00000000000191"
    assert row["unit_code"] == "000001"
    assert row["type_id"] == 3
    assert row["type_name"] == "Contrato"
    assert row["category_id"] == 1
    assert row["category_name"] == "Materiais"
    assert row["supplier_tax_id"] == "11222333000144"
    assert row["is_revenue"] is False
    assert row["from_price_registry"] is True
    assert row["parliamentary_amendment"] is False
    assert row["signed_at"] == "2026-01-10"
    assert row["source_global_updated_at"] == "2026-01-11T10:05:00"
    assert row["origin_system"] == "Sistema Origem X"


def test_row_from_contract_dto_missing_nested_objects_default_to_none():
    dto = _contract_dto(
        orgaoEntidade=None,
        unidadeOrgao=None,
        tipoContrato=None,
        categoriaProcesso=None,
    )

    row = row_from_contract_dto(dto)

    assert row["agency_tax_id"] is None
    assert row["unit_code"] is None
    assert row["type_id"] is None
    assert row["type_name"] is None
    assert row["category_id"] is None
    assert row["category_name"] is None


def _amendment_dto(**overrides):
    dto = {
        "sequencialTermoContrato": 1,
        "numeroTermoContrato": "T1",
        "tipoTermoContratoNome": "Aditivo",
        "objetoTermoContrato": "Prorrogação de prazo",
        "fundamentoLegal": "Art. 57",
        "informativoObservacao": "Observação livre",
        "qualificacaoAcrescimoSupressao": True,
        "qualificacaoVigencia": True,
        "qualificacaoFornecedor": False,
        "qualificacaoReajuste": False,
        "valorAcrescido": 500.00,
        "numeroParcelas": 3,
        "valorParcela": 166.66,
        "valorGlobal": 12500.00,
        "prazoAditadoDias": 90,
        "niFornecedor": "11222333000144",
        "nomeRazaoSocialFornecedor": "Fornecedor LTDA",
        "dataAssinatura": "2026-06-01",
        "dataVigenciaInicio": "2026-06-15",
        "dataVigenciaFim": "2027-06-15",
        "dataPublicacaoPncp": "2026-06-02T09:00:00",
        "dataInclusao": "2026-06-01T08:00:00",
        "dataAtualizacao": "2026-06-02T09:00:00",
    }
    dto.update(overrides)
    return dto


def test_row_from_amendment_dto_maps_qualifiers_json():
    row = row_from_amendment_dto(42, _amendment_dto())

    assert row["contract_id"] == 42
    assert row["sequence"] == 1
    assert row["number"] == "T1"
    assert row["notes"] == "Observação livre"
    assert isinstance(row["qualifiers"], Json)
    assert row["qualifiers"].obj == {
        "added_or_removed": True,
        "term": True,
        "supplier": False,
        "readjustment": False,
        "informative": "Observação livre",
    }
    assert row["value_added"] == 500.00
    assert row["extended_days"] == 90
    assert row["source_created_at"] == "2026-06-01T08:00:00"


# ------------------------------------------------------------- procurement id


def test_resolve_procurement_id_returns_none_when_source_id_missing():
    cursor = MagicMock()

    result = resolve_procurement_id(cursor, None)

    assert result is None
    cursor.execute.assert_not_called()


def test_resolve_procurement_id_returns_id_when_found():
    cursor = MagicMock()
    cursor.fetchone.return_value = (99,)

    result = resolve_procurement_id(cursor, "00000000000191-1-000001/2026")

    assert result == 99
    cursor.execute.assert_called_once()
    sql, params = cursor.execute.call_args.args
    assert "procurements" in sql
    assert params == ("00000000000191-1-000001/2026",)


def test_resolve_procurement_id_returns_none_when_absent():
    cursor = MagicMock()
    cursor.fetchone.return_value = None

    assert resolve_procurement_id(cursor, "unknown") is None


# ------------------------------------------------------------------ upserts


def test_contract_upsert_resets_amendments_synced_at_on_a_real_update():
    # A contract PNCP actually changed may have gained/changed /termos, so
    # the stamp must be cleared inside the freshness-guarded DO UPDATE.
    assert "amendments_synced_at = NULL" in _UPSERT_CONTRACT_SQL
    set_clause, where_clause = _UPSERT_CONTRACT_SQL.split("WHERE contracts.")
    assert "amendments_synced_at = NULL" in set_clause
    assert "source_global_updated_at" in where_clause


def test_upsert_contract_uses_shared_buyer_upserts_with_normalized_tax_id():
    cursor = MagicMock()
    cursor.fetchone.return_value = None
    # PNCP occasionally drops a CNPJ's leading zero (int round-trip); the
    # shared helper zero-pads it back to the CHAR(14) key form.
    dto = _contract_dto(
        orgaoEntidade={"cnpj": "360305000104", "razaoSocial": "Caixa", "poderId": "E"}
    )

    assert upsert_contract(cursor, dto) is True

    agency_params = cursor.execute.call_args_list[0].args[1]
    assert agency_params["tax_id"] == "00360305000104"
    contract_params = next(
        c.args[1] for c in cursor.execute.call_args_list if "INSERT INTO contracts" in c.args[0]
    )
    assert contract_params["agency_tax_id"] == "00360305000104"


def test_upsert_contract_agency_upsert_never_nulls_a_stored_name():
    cursor = MagicMock()
    cursor.fetchone.return_value = None

    upsert_contract(cursor, _contract_dto(orgaoEntidade={"cnpj": "00000000000191"}))

    agency_sql, agency_params = cursor.execute.call_args_list[0].args
    # NOT NULL column: a nameless DTO falls back to the tax id, and the
    # update COALESCEs so a later nameless fetch can't erase a good name.
    assert agency_params["name"] == "00000000000191"
    assert "name = COALESCE(EXCLUDED.name, agencies.name)" in agency_sql


def test_upsert_contract_skips_dto_without_agency_cnpj():
    cursor = MagicMock()
    counters = RunCounters()

    assert upsert_contract(cursor, _contract_dto(orgaoEntidade={}), counters=counters) is False

    # Nothing at all is written: `contracts.agency_tax_id` is NOT NULL, so the
    # INSERT would abort the whole run.
    sqls = [c.args[0] for c in cursor.execute.call_args_list]
    assert not any("INSERT INTO contracts" in s for s in sqls)
    assert not any("INSERT INTO source_payloads" in s for s in sqls)
    assert counters["contracts_skipped_incomplete"] == 1


def test_sync_contracts_skips_incomplete_dto_without_aborting_the_run():
    conn, _cursor = _mock_conn(watermark_row=None, bootstrap_row=None)

    client = MagicMock()
    bad = _contract_dto(orgaoEntidade=None, dataAtualizacaoGlobal="2026-01-11T13:00:00")
    good = _contract_dto(
        numeroControlePNCP="00000000000191-2-000019/2026",
        dataAtualizacaoGlobal="2026-01-11T12:00:00",
    )
    client.fetch_contracts_page.return_value = {
        "data": [bad, good],
        "paginasRestantes": 0,
        "numeroPagina": 1,
    }
    counters = RunCounters()

    result = sync_contracts(
        conn, since=date(2026, 1, 11), until=date(2026, 1, 11), client=client, counters=counters
    )

    assert result["rows_seen"] == 1
    assert counters["contracts_skipped_incomplete"] == 1
    assert counters["contracts"] == 1
    # the skipped DTO still moves the watermark — it was genuinely seen
    assert result["watermark"] == "2026-01-11T13:00:00"


def test_upsert_contract_writes_agency_unit_contract_and_payload_in_order():
    cursor = MagicMock()
    cursor.fetchone.return_value = (7,)  # resolve_procurement_id finds a match

    upsert_contract(cursor, _contract_dto())

    sqls = [c.args[0] for c in cursor.execute.call_args_list]
    assert "INSERT INTO agencies" in sqls[0]
    assert "INSERT INTO agency_units" in sqls[1]
    assert "SELECT id FROM procurements" in sqls[2]
    assert "INSERT INTO contracts" in sqls[3]
    assert "INSERT INTO source_payloads" in sqls[4]

    contract_params = cursor.execute.call_args_list[3].args[1]
    assert contract_params["procurement_id"] == 7
    assert contract_params["source_id"] == "00000000000191-2-000017/2026"

    payload_params = cursor.execute.call_args_list[4].args[1]
    assert payload_params["entity_type"] == "contract"
    assert payload_params["external_id"] == "00000000000191-2-000017/2026"


def test_upsert_contract_skips_agency_unit_when_no_unit_code():
    cursor = MagicMock()
    cursor.fetchone.return_value = None

    upsert_contract(cursor, _contract_dto(unidadeOrgao={}))

    sqls = [c.args[0] for c in cursor.execute.call_args_list]
    # agency, procurement lookup, contract, payload — no agency_units insert
    assert "INSERT INTO agency_units" not in " ".join(sqls)
    assert len(sqls) == 4


def test_upsert_contract_procurement_id_null_when_absent():
    cursor = MagicMock()

    upsert_contract(cursor, _contract_dto(numeroControlePncpCompra=None))

    contract_params = cursor.execute.call_args_list[2].args[1]
    assert contract_params["procurement_id"] is None
    # no SELECT against procurements was even issued
    sqls = [c.args[0] for c in cursor.execute.call_args_list]
    assert not any("SELECT id FROM procurements" in s for s in sqls)


# ------------------------------------------------------------------ watermark


def test_resolve_window_start_prefers_existing_watermark():
    result = _resolve_window_start("2026-01-05T00:00:00", date(2026, 1, 1), date(2026, 1, 10))
    assert result == date(2026, 1, 5)


def test_resolve_window_start_falls_back_to_since_then_bootstrap():
    assert _resolve_window_start(None, date(2026, 1, 1), date(2026, 1, 10)) == date(2026, 1, 1)
    assert _resolve_window_start(None, None, date(2026, 1, 10)) == date(2026, 1, 10)


def test_iter_date_chunks_splits_into_chunk_days_windows():
    chunks = list(_iter_date_chunks(date(2026, 1, 1), date(2026, 1, 20)))

    assert chunks[0] == (date(2026, 1, 1), date(2026, 1, 7))
    assert chunks[1] == (date(2026, 1, 8), date(2026, 1, 14))
    assert chunks[2] == (date(2026, 1, 15), date(2026, 1, 20))
    assert all((b - a).days < CHUNK_DAYS for a, b in chunks)


def test_iter_date_chunks_single_chunk_when_range_within_chunk_days():
    chunks = list(_iter_date_chunks(date(2026, 1, 1), date(2026, 1, 2)))
    assert chunks == [(date(2026, 1, 1), date(2026, 1, 2))]


# ------------------------------------------------------------- sync_contracts


def _mock_conn(watermark_row=None, bootstrap_row=None):
    """Single shared cursor mock, like tests/lixto/test_runs.py's helper.

    `fetchone` is called twice by `sync_contracts` before any paging starts
    (watermark, then bootstrap fallback); every subsequent call is
    `resolve_procurement_id` inside `upsert_contract` (one per DTO
    processed) — defaulted to "not found" (None) since procurement
    resolution itself is covered by its own dedicated tests above.
    """
    cursor = MagicMock()
    cursor.fetchone.side_effect = itertools.chain(
        [watermark_row, bootstrap_row], itertools.repeat(None)
    )

    conn = MagicMock()
    conn.cursor.return_value.__enter__.return_value = cursor
    conn.cursor.return_value.__exit__.return_value = False
    return conn, cursor


def _empty_page(page=1):
    return {"data": [], "totalRegistros": 0, "paginasRestantes": 0, "numeroPagina": page}


def test_sync_contracts_bootstraps_upserts_and_advances_watermark():
    conn, cursor = _mock_conn(watermark_row=None, bootstrap_row=None)

    client = MagicMock()
    dto1 = _contract_dto(dataAtualizacaoGlobal="2026-01-11T10:05:00")
    dto2 = _contract_dto(
        numeroControlePNCP="00000000000191-2-000018/2026",
        dataAtualizacaoGlobal="2026-01-11T12:00:00",
    )
    client.fetch_contracts_page.return_value = {
        "data": [dto1, dto2],
        "paginasRestantes": 0,
        "numeroPagina": 1,
    }

    result = sync_contracts(
        conn,
        since=date(2026, 1, 10),
        until=date(2026, 1, 11),
        client=client,
    )

    assert result["rows_seen"] == 2
    assert result["watermark"] == "2026-01-11T12:00:00"

    client.fetch_contracts_page.assert_called_once_with(
        date_from="20260110", date_to="20260111", page=1, updated=True
    )

    # last execute call on the shared cursor is the watermark upsert
    last_sql = cursor.execute.call_args_list[-1].args[0]
    assert "INSERT INTO sync_state" in last_sql
    conn.commit.assert_called()


def test_sync_contracts_advances_watermark_to_until_on_first_ever_quiet_run():
    # No prior watermark and zero rows seen: the bootstrap window must not
    # keep re-widening every day, so the watermark still jumps to `until`.
    conn, _cursor = _mock_conn(watermark_row=None, bootstrap_row=None)

    client = MagicMock()
    client.fetch_contracts_page.return_value = _empty_page()

    result = sync_contracts(conn, since=date(2026, 1, 1), until=date(2026, 1, 5), client=client)

    assert result["rows_seen"] == 0
    assert result["watermark"] == "2026-01-05T00:00:00"


def test_sync_contracts_keeps_existing_watermark_when_no_rows_seen():
    # A watermark already exists: a quiet run leaves it untouched (the
    # window it defines already reaches `until` again next run).
    conn, _cursor = _mock_conn(watermark_row=("2026-01-01T00:00:00",), bootstrap_row=None)

    client = MagicMock()
    client.fetch_contracts_page.return_value = _empty_page()

    result = sync_contracts(conn, until=date(2026, 1, 5), client=client)

    assert result["rows_seen"] == 0
    assert result["watermark"] == "2026-01-01T00:00:00"


def test_sync_contracts_chunks_wide_ranges_into_multiple_calls():
    conn, _cursor = _mock_conn(watermark_row=None, bootstrap_row=None)

    client = MagicMock()
    client.fetch_contracts_page.return_value = _empty_page()

    sync_contracts(conn, since=date(2026, 1, 1), until=date(2026, 1, 20), client=client)

    calls = client.fetch_contracts_page.call_args_list
    assert len(calls) == 3
    assert calls[0].kwargs["date_from"] == "20260101"
    assert calls[0].kwargs["date_to"] == "20260107"
    assert calls[1].kwargs["date_from"] == "20260108"
    assert calls[2].kwargs["date_to"] == "20260120"


def test_sync_contracts_pages_within_a_chunk_until_drained():
    conn, _cursor = _mock_conn(watermark_row=None, bootstrap_row=None)

    client = MagicMock()
    dto = _contract_dto(dataAtualizacaoGlobal="2026-01-01T00:00:00")
    page1 = {"data": [dto], "paginasRestantes": 1, "numeroPagina": 1}
    page2 = {"data": [], "paginasRestantes": 0, "numeroPagina": 2}
    client.fetch_contracts_page.side_effect = [page1, page2]

    result = sync_contracts(conn, since=date(2026, 1, 1), until=date(2026, 1, 1), client=client)

    assert result["rows_seen"] == 1
    assert client.fetch_contracts_page.call_count == 2
    assert client.fetch_contracts_page.call_args_list[0].kwargs["page"] == 1
    assert client.fetch_contracts_page.call_args_list[1].kwargs["page"] == 2


def test_sync_contracts_noop_when_window_start_after_until():
    conn, cursor = _mock_conn(watermark_row=("2026-02-01T00:00:00",), bootstrap_row=None)

    client = MagicMock()

    result = sync_contracts(conn, until=date(2026, 1, 1), client=client)

    assert result["rows_seen"] == 0
    assert result["watermark"] == "2026-02-01T00:00:00"
    client.fetch_contracts_page.assert_not_called()
    # watermark untouched: only the two initial SELECTs ran
    assert cursor.execute.call_count == 2


# ------------------------------------------------------------ sync_amendments


def _pending_row(contract_id=1, source_id="src-1", agency="00000000000191", year=2026, seq=17):
    return (contract_id, source_id, agency, year, seq)


def _mock_amendments_conn(pending_rows):
    cursor = MagicMock()
    cursor.fetchall.return_value = pending_rows

    conn = MagicMock()
    conn.cursor.return_value.__enter__.return_value = cursor
    conn.cursor.return_value.__exit__.return_value = False
    return conn, cursor


def test_sync_amendments_replaces_rows_and_stamps_even_when_zero():
    conn, cursor = _mock_amendments_conn([_pending_row()])
    client = MagicMock()
    client.fetch_contract_amendments.return_value = []

    result = sync_amendments(conn, client=client)

    assert result == {"processed": 1, "amendments": 0}

    sqls = [c.args[0] for c in cursor.execute.call_args_list]
    # SELECT pending, DELETE, source_payloads upsert, stamp — no amendment INSERT
    assert any("DELETE FROM contract_amendments" in s for s in sqls)
    assert "UPDATE contracts SET amendments_synced_at" in sqls[-1]
    assert not any("INSERT INTO contract_amendments" in s for s in sqls)

    payload_call = next(c for c in cursor.execute.call_args_list if "source_payloads" in c.args[0])
    assert payload_call.args[1]["payload"].obj == []


def test_sync_amendments_inserts_each_amendment_and_stamps():
    conn, cursor = _mock_amendments_conn([_pending_row(contract_id=5, source_id="src-5")])
    client = MagicMock()
    client.fetch_contract_amendments.return_value = [
        _amendment_dto(),
        _amendment_dto(sequencialTermoContrato=2),
    ]

    result = sync_amendments(conn, client=client)

    assert result == {"processed": 1, "amendments": 2}
    insert_calls = [
        c for c in cursor.execute.call_args_list if "INSERT INTO contract_amendments" in c.args[0]
    ]
    assert len(insert_calls) == 2
    assert insert_calls[0].args[1]["contract_id"] == 5
    assert insert_calls[1].args[1]["sequence"] == 2


def test_sync_amendments_skips_contract_on_pncp_api_error():
    conn, _cursor = _mock_amendments_conn(
        [_pending_row(contract_id=1, source_id="a"), _pending_row(contract_id=2, source_id="b")]
    )
    client = MagicMock()
    client.fetch_contract_amendments.side_effect = [PncpApiError("boom"), []]

    result = sync_amendments(conn, client=client)

    assert result == {"processed": 1, "amendments": 0}
    assert client.fetch_contract_amendments.call_count == 2


def test_sync_amendments_passes_limit_through_to_the_select():
    conn, cursor = _mock_amendments_conn([])
    client = MagicMock()

    sync_amendments(conn, limit=10, client=client)

    sql, params = cursor.execute.call_args.args
    assert "LIMIT %(limit)s" in sql
    assert params["limit"] == 10


def test_sync_amendments_uses_agency_year_sequence_from_the_row():
    conn, _cursor = _mock_amendments_conn(
        [_pending_row(contract_id=9, source_id="s-9", agency="11111111000191", year=2025, seq=3)]
    )
    client = MagicMock()
    client.fetch_contract_amendments.return_value = []

    sync_amendments(conn, client=client)

    client.fetch_contract_amendments.assert_called_once_with(
        agency_tax_id="11111111000191", year=2025, sequence=3
    )


def test_sync_amendments_stamps_contracts_without_year_or_sequence():
    # `contracts.year`/`.sequence` are nullable; interpolating None into the
    # /termos URL would fetch a literal ".../None/None/termos".
    conn, cursor = _mock_amendments_conn(
        [_pending_row(contract_id=4, source_id="s-4", year=None, seq=None)]
    )
    client = MagicMock()
    counters = RunCounters()

    result = sync_amendments(conn, client=client, counters=counters)

    assert result == {"processed": 0, "amendments": 0}
    client.fetch_contract_amendments.assert_not_called()
    # stamped anyway, or the pending queue hands the row back every run
    assert "UPDATE contracts SET amendments_synced_at" in cursor.execute.call_args.args[0]
    assert counters["contracts_skipped_no_year_sequence"] == 1
