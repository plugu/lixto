"""Unit tests for src/plic/sync_publicacao.py.

Fixture-based, no network and no live database: uses
tests/fixtures/publicacao_page.json for real-shaped DTOs and MagicMock for
the psycopg cursor/connection.
"""

import json
from datetime import date
from pathlib import Path
from unittest.mock import MagicMock

from plic.sync_publicacao import (
    _UPSERT_SQL,
    row_from_publicacao_dto,
    sync_publicacao,
    upsert_licitacao,
)

FIXTURE_PATH = Path(__file__).parent / "fixtures" / "publicacao_page.json"


def _load_fixture_dtos() -> list[dict]:
    return json.loads(FIXTURE_PATH.read_text())["data"]


def test_row_from_publicacao_dto_flattens_nested_objects():
    dto = _load_fixture_dtos()[0]

    row = row_from_publicacao_dto(dto)

    assert row["numero_controle_pncp"] == dto["numeroControlePNCP"]
    assert row["orgao_cnpj"] == dto["orgaoEntidade"]["cnpj"]
    assert row["orgao_razao_social"] == dto["orgaoEntidade"]["razaoSocial"]
    assert row["poder_id"] == dto["orgaoEntidade"]["poderId"]
    assert row["esfera_id"] == dto["orgaoEntidade"]["esferaId"]
    assert row["unidade_codigo"] == dto["unidadeOrgao"]["codigoUnidade"]
    assert row["unidade_nome"] == dto["unidadeOrgao"]["nomeUnidade"]
    assert row["uf"] == dto["unidadeOrgao"]["ufSigla"]
    assert row["municipio_nome"] == dto["unidadeOrgao"]["municipioNome"]
    assert row["codigo_ibge"] == dto["unidadeOrgao"]["codigoIbge"]
    assert row["amparo_legal_codigo"] == str(dto["amparoLegal"]["codigo"])
    assert row["amparo_legal_nome"] == dto["amparoLegal"]["nome"]
    assert row["data_atualizacao_global"] == dto["dataAtualizacaoGlobal"]
    # Full DTO preserved verbatim in raw.
    assert row["raw"].obj == dto


def test_row_from_publicacao_dto_handles_nullable_dates_and_missing_nested_objects():
    dto = {
        "numeroControlePNCP": "00000000000000-1-000001/2026",
        "modalidadeId": 8,
        "modalidadeNome": "Dispensa",
        # dispensa/inexigibilidade often have no proposal window
        "dataAberturaProposta": None,
        "dataEncerramentoProposta": None,
        "dataAtualizacaoGlobal": "2026-01-02T10:00:00",
        # orgaoEntidade / unidadeOrgao / amparoLegal entirely absent
    }

    row = row_from_publicacao_dto(dto)

    assert row["data_abertura_proposta"] is None
    assert row["data_encerramento_proposta"] is None
    assert row["orgao_cnpj"] is None
    assert row["unidade_codigo"] is None
    assert row["amparo_legal_codigo"] is None
    assert row["amparo_legal_nome"] is None
    assert row["fontes_orcamentarias"].obj == []


def test_upsert_licitacao_executes_freshness_guarded_upsert():
    cursor = MagicMock()
    dto = _load_fixture_dtos()[0]

    upsert_licitacao(cursor, dto)

    assert cursor.execute.call_count == 1
    executed_sql, executed_params = cursor.execute.call_args.args
    assert executed_sql is _UPSERT_SQL
    assert "ON CONFLICT (numero_controle_pncp) DO UPDATE" in executed_sql
    assert (
        "WHERE EXCLUDED.data_atualizacao_global > licitacao.data_atualizacao_global"
        in executed_sql
    )
    # On any real update, both sync stamps are reset so details get re-fetched.
    assert "itens_sincronizados_em = NULL" in executed_sql
    assert "arquivos_sincronizados_em = NULL" in executed_sql
    assert executed_params["numero_controle_pncp"] == dto["numeroControlePNCP"]


def test_sync_publicacao_pages_each_modalidade_and_upserts_rows():
    fixture_dtos = _load_fixture_dtos()[:2]
    page = {
        "data": fixture_dtos,
        "totalRegistros": 2,
        "totalPaginas": 1,
        "numeroPagina": 1,
        "paginasRestantes": 0,
        "empty": False,
    }

    fake_client = MagicMock()
    fake_client.iter_publicacao_pages.return_value = [page]

    cursor = MagicMock()
    conn = MagicMock()
    conn.cursor.return_value.__enter__.return_value = cursor
    conn.cursor.return_value.__exit__.return_value = False

    totals = sync_publicacao(
        conn,
        data_inicial=date(2026, 1, 2),
        data_final=date(2026, 1, 2),
        modalidades=[6],
        client=fake_client,
    )

    assert totals == {6: 2}
    assert cursor.execute.call_count == 2
    fake_client.iter_publicacao_pages.assert_called_once_with(
        data_inicial="20260102",
        data_final="20260102",
        codigo_modalidade_contratacao=6,
    )
    conn.commit.assert_called()
    # Caller-supplied client is not closed by sync_publicacao.
    fake_client.close.assert_not_called()


def test_sync_publicacao_syncs_all_13_modalidades_by_default():
    empty_page = {
        "data": [],
        "totalRegistros": 0,
        "totalPaginas": 0,
        "numeroPagina": 1,
        "paginasRestantes": 0,
        "empty": True,
    }
    fake_client = MagicMock()
    fake_client.iter_publicacao_pages.return_value = [empty_page]

    conn = MagicMock()
    conn.cursor.return_value.__enter__.return_value = MagicMock()
    conn.cursor.return_value.__exit__.return_value = False

    totals = sync_publicacao(
        conn,
        data_inicial=date(2026, 1, 2),
        data_final=date(2026, 1, 2),
        client=fake_client,
    )

    assert sorted(totals.keys()) == list(range(1, 14))
    assert fake_client.iter_publicacao_pages.call_count == 13
    fake_client.iter_publicacao_pages.assert_any_call(
        data_inicial="20260102", data_final="20260102", codigo_modalidade_contratacao=1
    )
