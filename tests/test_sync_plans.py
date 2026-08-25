"""Unit tests for src/lixto/sync/plans.py.

Fully mocked psycopg connections/cursors and a mocked PncpClient — no
network, no live database.
"""

import json
from datetime import date
from unittest.mock import MagicMock

import pytest

from lixto.runs import RunCounters
from lixto.sync import plans as plans_module

# --- DTO -> row mapping ------------------------------------------------


def _plan_dto(**overrides):
    dto = {
        "idPcaPncp": "00000000000191-1-000001/2026",
        "orgaoEntidadeCnpj": "00.000.000/0001-91",
        "orgaoEntidadeRazaoSocial": "Prefeitura Municipal de Exemplo",
        "codigoUnidade": "000001",
        "nomeUnidade": "Secretaria de Administração",
        "anoPca": 2026,
        "dataPublicacaoPNCP": "2026-01-15T10:00:00",
        "dataAtualizacaoGlobalPCA": "2026-08-20T09:30:00",
        "itens": [_item_dto()],
    }
    dto.update(overrides)
    return dto


def _item_dto(**overrides):
    item = {
        "numeroItem": 1,
        "categoriaItemPcaNome": "Material de consumo",
        "classificacaoCatalogoId": 1,
        "nomeClassificacaoCatalogo": "Material",
        "classificacaoSuperiorCodigo": "123",
        "classificacaoSuperiorNome": "Papelaria",
        "pdmCodigo": "PDM123",
        "pdmDescricao": "Lápis grafite",
        "codigoItem": "ITEM1",
        "descricaoItem": "Lápis grafite nº 2",
        "unidadeFornecimento": "UN",
        "quantidadeEstimada": 1000,
        "valorUnitario": 1.5,
        "valorTotal": 1500.0,
        "valorOrcamentoExercicio": 1500.0,
        "unidadeRequisitante": "Secretaria de Administração",
        "dataDesejada": "2026-06-01",
        "grupoContratacaoCodigo": "G1",
        "grupoContratacaoNome": "Grupo 1",
        "dataInclusao": "2026-01-10T08:00:00",
        "dataAtualizacao": "2026-01-15T10:00:00",
    }
    item.update(overrides)
    return item


def test_row_from_plan_dto_maps_fields_and_cleans_tax_id():
    row = plans_module.row_from_plan_dto(_plan_dto())

    assert row["source_id"] == "00000000000191-1-000001/2026"
    assert row["agency_tax_id"] == "00000000000191"
    assert row["unit_code"] == "000001"
    assert row["unit_name"] == "Secretaria de Administração"
    assert row["year"] == 2026
    assert row["published_at"] == "2026-01-15T10:00:00"
    assert row["source_global_updated_at"] == "2026-08-20T09:30:00"
    assert row["item_count"] == 1


def test_row_from_plan_dto_handles_missing_optional_fields():
    dto = _plan_dto(codigoUnidade=None, nomeUnidade=None, dataPublicacaoPNCP=None, itens=[])

    row = plans_module.row_from_plan_dto(dto)

    assert row["unit_code"] is None
    assert row["unit_name"] is None
    assert row["published_at"] is None
    assert row["item_count"] == 0


def test_row_from_plan_dto_tax_id_none_when_missing():
    dto = _plan_dto(orgaoEntidadeCnpj=None)

    row = plans_module.row_from_plan_dto(dto)

    assert row["agency_tax_id"] is None


def test_row_from_plan_item_dto_maps_fields():
    row = plans_module.row_from_plan_item_dto(42, _item_dto())

    assert row["plan_id"] == 42
    assert row["item_number"] == 1
    assert row["category_name"] == "Material de consumo"
    assert row["catalog_classification_id"] == 1
    assert row["catalog_classification_name"] == "Material"
    assert row["superior_classification_code"] == "123"
    assert row["superior_classification_name"] == "Papelaria"
    assert row["pdm_code"] == "PDM123"
    assert row["pdm_description"] == "Lápis grafite"
    assert row["item_code"] == "ITEM1"
    assert row["description"] == "Lápis grafite nº 2"
    assert row["supply_unit"] == "UN"
    assert row["estimated_quantity"] == 1000
    assert row["unit_value"] == 1.5
    assert row["total_value"] == 1500.0
    assert row["budget_year_value"] == 1500.0
    assert row["requesting_unit"] == "Secretaria de Administração"
    assert row["desired_date"] == "2026-06-01"
    assert row["contracting_group_code"] == "G1"
    assert row["contracting_group_name"] == "Grupo 1"
    assert row["source_created_at"] == "2026-01-10T08:00:00"
    assert row["source_updated_at"] == "2026-01-15T10:00:00"


def test_row_from_plan_item_dto_nulls_when_missing():
    row = plans_module.row_from_plan_item_dto(1, {"numeroItem": 1})

    assert row["category_name"] is None
    assert row["desired_date"] is None
    assert row["estimated_quantity"] is None


# --- upsert_plan (agency first, source_payload, items replaced) --------


def _mock_cursor():
    cursor = MagicMock()
    cursor.fetchone.return_value = (7,)
    return cursor


def test_upsert_plan_upserts_agency_before_plan_and_writes_payload():
    cursor = _mock_cursor()
    dto = _plan_dto()

    plans_module.upsert_plan(cursor, dto)

    executed_sql = [c.args[0] for c in cursor.execute.call_args_list]
    agency_idx = next(i for i, sql in enumerate(executed_sql) if "INSERT INTO agencies" in sql)
    payload_idx = next(
        i for i, sql in enumerate(executed_sql) if "INSERT INTO source_payloads" in sql
    )
    plan_idx = next(
        i for i, sql in enumerate(executed_sql) if "INSERT INTO procurement_plans" in sql
    )
    assert agency_idx < plan_idx
    assert payload_idx < plan_idx

    agency_params = cursor.execute.call_args_list[agency_idx].args[1]
    assert agency_params["tax_id"] == "00000000000191"
    assert agency_params["name"] == "Prefeitura Municipal de Exemplo"

    payload_params = cursor.execute.call_args_list[payload_idx].args[1]
    assert payload_params["external_id"] == "00000000000191-1-000001/2026"
    assert payload_params["payload"].obj == dto


def test_upsert_plan_replaces_items_delete_then_insert():
    cursor = _mock_cursor()
    dto = _plan_dto(itens=[_item_dto(numeroItem=1), _item_dto(numeroItem=2)])

    plan_id = plans_module.upsert_plan(cursor, dto)

    assert plan_id == 7
    executed_sql = [c.args[0] for c in cursor.execute.call_args_list]
    delete_idx = next(i for i, sql in enumerate(executed_sql) if "DELETE FROM" in sql)
    insert_indices = [
        i for i, sql in enumerate(executed_sql) if "INSERT INTO procurement_plan_items" in sql
    ]
    assert len(insert_indices) == 2
    assert all(delete_idx < i for i in insert_indices)

    for i in insert_indices:
        params = cursor.execute.call_args_list[i].args[1]
        assert params["plan_id"] == 7


def test_upsert_plan_returns_none_and_skips_items_when_not_fresher():
    cursor = _mock_cursor()
    cursor.fetchone.return_value = None
    dto = _plan_dto()

    plan_id = plans_module.upsert_plan(cursor, dto)

    assert plan_id is None
    executed_sql = [c.args[0] for c in cursor.execute.call_args_list]
    assert not any("DELETE FROM" in sql for sql in executed_sql)
    assert not any("INSERT INTO procurement_plan_items" in sql for sql in executed_sql)
    # agency + source_payload still happen unconditionally
    assert any("INSERT INTO agencies" in sql for sql in executed_sql)
    assert any("INSERT INTO source_payloads" in sql for sql in executed_sql)


def test_upsert_plan_skips_agency_upsert_when_tax_id_missing():
    cursor = _mock_cursor()
    dto = _plan_dto(orgaoEntidadeCnpj=None)

    plans_module.upsert_plan(cursor, dto)

    executed_sql = [c.args[0] for c in cursor.execute.call_args_list]
    assert not any("INSERT INTO agencies" in sql for sql in executed_sql)


# --- watermark helpers ---------------------------------------------------


def _mock_conn():
    cursor = MagicMock()
    conn = MagicMock()
    conn.cursor.return_value.__enter__.return_value = cursor
    conn.cursor.return_value.__exit__.return_value = False
    return conn, cursor


def test_watermark_key_format():
    assert plans_module.watermark_key() == "incremental:plans"


def test_get_watermark_reads_sync_state():
    conn, cursor = _mock_conn()
    cursor.fetchone.return_value = ("2026-08-01T00:00:00",)

    result = plans_module._get_watermark(conn)

    assert result == "2026-08-01T00:00:00"
    params = cursor.execute.call_args.args[1]
    assert params == (plans_module.watermark_key(),)


def test_get_watermark_none_when_absent():
    conn, cursor = _mock_conn()
    cursor.fetchone.return_value = None

    assert plans_module._get_watermark(conn) is None


def test_advance_watermark_upserts_sync_state():
    conn, cursor = _mock_conn()

    plans_module._advance_watermark(conn, "2026-08-20T09:30:00")

    executed_sql, executed_params = cursor.execute.call_args.args
    assert "INSERT INTO sync_state" in executed_sql
    assert "ON CONFLICT (key) DO UPDATE" in executed_sql
    assert executed_params["key"] == "incremental:plans"
    assert executed_params["value"].obj == {"watermark": "2026-08-20T09:30:00"}
    conn.commit.assert_called_once()


def test_resolve_window_start_prefers_existing_watermark():
    result = plans_module._resolve_window_start(
        "2026-08-01T00:00:00", date(2026, 7, 1), date(2026, 8, 10)
    )
    assert result == date(2026, 8, 1)


def test_resolve_window_start_falls_back_to_since():
    result = plans_module._resolve_window_start(None, date(2026, 7, 1), date(2026, 8, 10))
    assert result == date(2026, 7, 1)


def test_resolve_window_start_falls_back_to_until():
    result = plans_module._resolve_window_start(None, None, date(2026, 8, 10))
    assert result == date(2026, 8, 10)


# --- sync_plans orchestration --------------------------------------------


def _page(dtos, paginas_restantes=0):
    return {"data": dtos, "totalRegistros": len(dtos), "paginasRestantes": paginas_restantes}


def _empty_page_204():
    """The shape `PncpClient.fetch_plans_update_page` returns on HTTP 204."""
    return {
        "data": [],
        "totalRegistros": 0,
        "totalPaginas": 0,
        "numeroPagina": 1,
        "paginasRestantes": 0,
        "empty": True,
    }


def _patch_helpers(monkeypatch, *, watermark=None):
    monkeypatch.setattr(plans_module, "_get_watermark", lambda conn: watermark)
    advance_calls = []
    monkeypatch.setattr(
        plans_module,
        "_advance_watermark",
        lambda conn, wm: advance_calls.append(wm),
    )
    upsert_mock = MagicMock(return_value=1)
    monkeypatch.setattr(plans_module, "upsert_plan", upsert_mock)
    return advance_calls, upsert_mock


def test_sync_plans_handles_204_as_empty_page(monkeypatch):
    conn, _cursor = _mock_conn()
    advance_calls, upsert_mock = _patch_helpers(monkeypatch, watermark="2026-08-19T00:00:00")

    fake_client = MagicMock()
    fake_client.fetch_plans_update_page.return_value = _empty_page_204()

    result = plans_module.sync_plans(conn, until=date(2026, 8, 19), client=fake_client)

    assert result["plans_seen"] == 0
    upsert_mock.assert_not_called()
    # single-day window (watermark == until): advances to end-of-day fallback
    assert advance_calls == ["2026-08-19T23:59:59"]


def test_sync_plans_paginates_until_paginas_restantes_zero(monkeypatch):
    conn, _cursor = _mock_conn()
    _patch_helpers(monkeypatch, watermark="2026-08-19T00:00:00")

    dto1 = _plan_dto(idPcaPncp="plan-1", dataAtualizacaoGlobalPCA="2026-08-19T08:00:00")
    dto2 = _plan_dto(idPcaPncp="plan-2", dataAtualizacaoGlobalPCA="2026-08-19T09:00:00")
    fake_client = MagicMock()
    fake_client.fetch_plans_update_page.side_effect = [
        _page([dto1], paginas_restantes=1),
        _page([dto2], paginas_restantes=0),
    ]

    result = plans_module.sync_plans(conn, until=date(2026, 8, 19), client=fake_client)

    assert fake_client.fetch_plans_update_page.call_count == 2
    assert result["plans_seen"] == 2
    calls = fake_client.fetch_plans_update_page.call_args_list
    assert calls[0].kwargs["page"] == 1
    assert calls[1].kwargs["page"] == 2


def test_fetch_page_retries_on_json_decode_error_then_succeeds(monkeypatch):
    monkeypatch.setattr(plans_module.time, "sleep", lambda _seconds: None)
    fake_client = MagicMock()
    good_body = _page([])
    fake_client.fetch_plans_update_page.side_effect = [
        json.JSONDecodeError("Expecting value", "", 0),
        good_body,
    ]

    body = plans_module._fetch_page(fake_client, date_from="20260819", date_to="20260819", page=1)

    assert body is good_body
    assert fake_client.fetch_plans_update_page.call_count == 2


def test_fetch_page_raises_after_exhausting_retries(monkeypatch):
    monkeypatch.setattr(plans_module.time, "sleep", lambda _seconds: None)
    fake_client = MagicMock()
    fake_client.fetch_plans_update_page.side_effect = json.JSONDecodeError("Expecting value", "", 0)

    with pytest.raises(json.JSONDecodeError):
        plans_module._fetch_page(fake_client, date_from="20260819", date_to="20260819", page=1)

    assert fake_client.fetch_plans_update_page.call_count == plans_module._PAGE_FETCH_MAX_ATTEMPTS


def test_sync_plans_advances_watermark_to_max_seen_per_chunk(monkeypatch):
    conn, _cursor = _mock_conn()
    advance_calls, _upsert_mock = _patch_helpers(monkeypatch, watermark="2026-08-19T00:00:00")

    dto1 = _plan_dto(idPcaPncp="plan-1", dataAtualizacaoGlobalPCA="2026-08-19T08:00:00")
    dto2 = _plan_dto(idPcaPncp="plan-2", dataAtualizacaoGlobalPCA="2026-08-19T09:30:00")
    fake_client = MagicMock()
    fake_client.fetch_plans_update_page.return_value = _page([dto1, dto2])

    plans_module.sync_plans(conn, until=date(2026, 8, 19), client=fake_client)

    assert advance_calls == ["2026-08-19T09:30:00"]


def test_sync_plans_advances_watermark_once_per_chunk_not_per_page(monkeypatch):
    conn, _cursor = _mock_conn()
    advance_calls, _upsert_mock = _patch_helpers(monkeypatch, watermark="2026-08-01T00:00:00")

    fake_client = MagicMock()
    fake_client.fetch_plans_update_page.side_effect = [
        _page([_plan_dto(idPcaPncp="p1", dataAtualizacaoGlobalPCA="2026-08-01T01:00:00")], 1),
        _page([_plan_dto(idPcaPncp="p2", dataAtualizacaoGlobalPCA="2026-08-01T02:00:00")], 0),
    ]

    plans_module.sync_plans(conn, until=date(2026, 8, 1), client=fake_client)

    # two pages fetched, but only one chunk (single day window) -> one advance
    assert fake_client.fetch_plans_update_page.call_count == 2
    assert advance_calls == ["2026-08-01T02:00:00"]


def test_sync_plans_chunks_window_by_chunk_days(monkeypatch):
    conn, _cursor = _mock_conn()
    advance_calls, _upsert_mock = _patch_helpers(monkeypatch, watermark=None)

    fake_client = MagicMock()
    fake_client.fetch_plans_update_page.return_value = _page([])

    plans_module.sync_plans(
        conn,
        since=date(2026, 8, 1),
        until=date(2026, 8, 15),
        chunk_days=7,
        client=fake_client,
    )

    # 3 chunks: 08-01..08-07, 08-08..08-14, 08-15..08-15
    assert advance_calls == [
        "2026-08-07T23:59:59",
        "2026-08-14T23:59:59",
        "2026-08-15T23:59:59",
    ]
    date_windows = [
        (c.kwargs["date_from"], c.kwargs["date_to"])
        for c in fake_client.fetch_plans_update_page.call_args_list
    ]
    assert date_windows == [
        ("20260801", "20260807"),
        ("20260808", "20260814"),
        ("20260815", "20260815"),
    ]


def test_sync_plans_uses_since_when_no_watermark(monkeypatch):
    conn, _cursor = _mock_conn()
    _patch_helpers(monkeypatch, watermark=None)

    fake_client = MagicMock()
    fake_client.fetch_plans_update_page.return_value = _page([])

    plans_module.sync_plans(
        conn, since=date(2026, 8, 5), until=date(2026, 8, 5), client=fake_client
    )

    the_call = fake_client.fetch_plans_update_page.call_args_list[0]
    assert the_call.kwargs["date_from"] == "20260805"
    assert the_call.kwargs["date_to"] == "20260805"


def test_sync_plans_owns_and_closes_client_when_none_injected(monkeypatch):
    conn, _cursor = _mock_conn()
    _patch_helpers(monkeypatch, watermark="2026-08-19T00:00:00")

    fake_client = MagicMock()
    fake_client.fetch_plans_update_page.return_value = _page([])
    monkeypatch.setattr(plans_module, "PncpClient", MagicMock(return_value=fake_client))

    plans_module.sync_plans(conn, until=date(2026, 8, 19))

    fake_client.close.assert_called_once()


def test_sync_plans_does_not_close_injected_client(monkeypatch):
    conn, _cursor = _mock_conn()
    _patch_helpers(monkeypatch, watermark="2026-08-19T00:00:00")

    fake_client = MagicMock()
    fake_client.fetch_plans_update_page.return_value = _page([])

    plans_module.sync_plans(conn, until=date(2026, 8, 19), client=fake_client)

    fake_client.close.assert_not_called()


def test_sync_plans_fills_counters():
    conn, cursor = _mock_conn()
    cursor.fetchone.side_effect = [("2026-08-19T00:00:00",), None]
    fake_client = MagicMock()
    fake_client.fetch_plans_update_page.return_value = _page(
        [_plan_dto(idPcaPncp="p1", dataAtualizacaoGlobalPCA="2026-08-19T08:00:00")]
    )
    counters = RunCounters()

    result = plans_module.sync_plans(
        conn, until=date(2026, 8, 19), client=fake_client, counters=counters
    )

    assert counters["plans_seen"] == result["plans_seen"] == 1
    assert counters["chunks"] == 1
