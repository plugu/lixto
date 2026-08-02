"""Unit tests for src/plic/sync_incremental.py.

No network, no live database: watermark bootstrap/resolve/advance helpers
are tested directly against MagicMock cursors/connections, and orchestration
tests monkeypatch the DB-touching helpers plus `upsert_licitacao`/
`sync_detalhes` so nothing hits psycopg or httpx for real.
"""

from datetime import UTC, date, datetime
from unittest.mock import MagicMock

from plic import sync_incremental as sync_incremental_module
from plic.pncp_client import PncpApiError

# --- watermark_key / pure resolve logic -----------------------------------


def test_watermark_key_format():
    assert sync_incremental_module.watermark_key(6) == "incremental:6"


def test_resolve_window_start_prefers_existing_watermark():
    result = sync_incremental_module._resolve_window_start(
        "2026-07-15T08:00:00", date(2026, 7, 1), date(2026, 1, 1)
    )

    assert result == date(2026, 7, 15)


def test_resolve_window_start_falls_back_to_since_when_no_watermark():
    result = sync_incremental_module._resolve_window_start(None, date(2026, 7, 1), date(2026, 1, 1))

    assert result == date(2026, 7, 1)


def test_resolve_window_start_falls_back_to_bootstrap_when_no_watermark_or_since():
    result = sync_incremental_module._resolve_window_start(None, None, date(2026, 1, 1))

    assert result == date(2026, 1, 1)


# --- DB helpers ------------------------------------------------------------


def _mock_conn():
    cursor = MagicMock()
    conn = MagicMock()
    conn.cursor.return_value.__enter__.return_value = cursor
    conn.cursor.return_value.__exit__.return_value = False
    return conn, cursor


def test_get_existing_watermarks_parses_modalidade_from_key():
    conn, cursor = _mock_conn()
    cursor.fetchall.return_value = [
        ("incremental:6", "2026-07-15T08:00:00"),
        ("incremental:8", None),
    ]

    result = sync_incremental_module._get_existing_watermarks(conn)

    assert result == {6: "2026-07-15T08:00:00", 8: None}


def test_bootstrap_start_date_uses_newest_data_atualizacao_global():
    conn, cursor = _mock_conn()
    cursor.fetchone.return_value = (datetime(2026, 7, 20, 10, 0, 0, tzinfo=UTC),)

    result = sync_incremental_module._bootstrap_start_date(conn)

    assert result == date(2026, 7, 20)


def test_bootstrap_start_date_falls_back_to_today_when_db_empty():
    conn, cursor = _mock_conn()
    cursor.fetchone.return_value = (None,)

    result = sync_incremental_module._bootstrap_start_date(conn)

    assert result == datetime.now(UTC).date()


def test_advance_watermark_upserts_sync_state_value():
    conn, cursor = _mock_conn()

    sync_incremental_module._advance_watermark(conn, 6, "2026-07-20T10:00:00")

    executed_sql, executed_params = cursor.execute.call_args.args
    assert "INSERT INTO sync_state" in executed_sql
    assert "ON CONFLICT (key) DO UPDATE" in executed_sql
    assert executed_params["key"] == "incremental:6"
    assert executed_params["value"].obj == {"watermark": "2026-07-20T10:00:00"}
    conn.commit.assert_called_once()


# --- orchestration -----------------------------------------------------


def _atualizacao_page(dtos, paginas_restantes=0):
    return {"data": dtos, "totalRegistros": len(dtos), "paginasRestantes": paginas_restantes}


def _dto(numero_controle, data_atualizacao_global):
    return {"numeroControlePNCP": numero_controle, "dataAtualizacaoGlobal": data_atualizacao_global}


def _patch_db_helpers(monkeypatch, *, existing_watermarks=None, bootstrap_date=date(2026, 7, 30)):
    monkeypatch.setattr(
        sync_incremental_module, "_get_existing_watermarks", lambda conn: existing_watermarks or {}
    )
    monkeypatch.setattr(sync_incremental_module, "_bootstrap_start_date", lambda conn: bootstrap_date)
    advance_calls = []
    monkeypatch.setattr(
        sync_incremental_module,
        "_advance_watermark",
        lambda conn, modalidade, watermark: advance_calls.append((modalidade, watermark)),
    )
    monkeypatch.setattr(sync_incremental_module, "upsert_licitacao", MagicMock())
    monkeypatch.setattr(sync_incremental_module, "sync_detalhes", MagicMock(return_value=0))
    return advance_calls


def test_sync_incremental_advances_watermark_to_max_dto_seen(monkeypatch):
    conn, _cursor = _mock_conn()
    advance_calls = _patch_db_helpers(monkeypatch)

    fake_client = MagicMock()
    fake_client.iter_atualizacao_pages.return_value = [
        _atualizacao_page(
            [_dto("ctrl-1", "2026-08-01T10:00:00"), _dto("ctrl-2", "2026-08-02T09:00:00")]
        )
    ]

    result = sync_incremental_module.sync_incremental(
        conn,
        modalidades=[6],
        client=fake_client,
        detalhes_client=MagicMock(),
        until=date(2026, 8, 2),
    )

    assert result["modalidades_advanced"] == 1
    assert result["modalidades_failed"] == []
    assert result["rows_seen"] == 2
    assert advance_calls == [(6, "2026-08-02T09:00:00")]
    assert sync_incremental_module.upsert_licitacao.call_count == 2


def test_sync_incremental_zero_rows_advances_watermark_to_until(monkeypatch):
    conn, _cursor = _mock_conn()
    advance_calls = _patch_db_helpers(monkeypatch)

    fake_client = MagicMock()
    fake_client.iter_atualizacao_pages.return_value = [_atualizacao_page([])]

    result = sync_incremental_module.sync_incremental(
        conn,
        modalidades=[6],
        client=fake_client,
        detalhes_client=MagicMock(),
        until=date(2026, 8, 2),
    )

    assert result["modalidades_advanced"] == 1
    assert result["rows_seen"] == 0
    assert advance_calls == [(6, "2026-08-02T00:00:00")]


def test_sync_incremental_one_modalidade_failure_does_not_block_others(monkeypatch):
    conn, _cursor = _mock_conn()
    advance_calls = _patch_db_helpers(monkeypatch)

    fake_client = MagicMock()

    def fake_iter(*, data_inicial, data_final, codigo_modalidade_contratacao, tamanho_pagina=50):
        if codigo_modalidade_contratacao == 8:
            raise PncpApiError("boom")
        return iter([_atualizacao_page([])])

    fake_client.iter_atualizacao_pages.side_effect = fake_iter

    result = sync_incremental_module.sync_incremental(
        conn,
        modalidades=[6, 8, 9],
        client=fake_client,
        detalhes_client=MagicMock(),
        until=date(2026, 8, 2),
    )

    assert result["modalidades_failed"] == [8]
    assert result["modalidades_advanced"] == 2
    assert {m for m, _ in advance_calls} == {6, 9}


def test_sync_incremental_loops_sync_detalhes_until_zero_processed(monkeypatch):
    conn, _cursor = _mock_conn()
    _patch_db_helpers(monkeypatch)
    sync_detalhes_mock = MagicMock(side_effect=[500, 200, 0])
    monkeypatch.setattr(sync_incremental_module, "sync_detalhes", sync_detalhes_mock)

    fake_client = MagicMock()
    fake_client.iter_atualizacao_pages.return_value = [_atualizacao_page([])]

    result = sync_incremental_module.sync_incremental(
        conn,
        modalidades=[6],
        client=fake_client,
        detalhes_client=MagicMock(),
        until=date(2026, 8, 2),
    )

    assert sync_detalhes_mock.call_count == 3
    assert result["detalhes_processed"] == 700


def test_sync_incremental_owns_and_closes_clients_when_none_injected(monkeypatch):
    conn, _cursor = _mock_conn()
    _patch_db_helpers(monkeypatch)

    fake_publicacao_like_client = MagicMock()
    fake_publicacao_like_client.iter_atualizacao_pages.return_value = [_atualizacao_page([])]
    fake_detalhes_client = MagicMock()
    client_ctor = MagicMock(side_effect=[fake_publicacao_like_client, fake_detalhes_client])
    monkeypatch.setattr(sync_incremental_module, "PncpClient", client_ctor)

    sync_incremental_module.sync_incremental(conn, modalidades=[6], until=date(2026, 8, 2))

    fake_publicacao_like_client.close.assert_called_once()
    fake_detalhes_client.close.assert_called_once()


def test_sync_incremental_uses_existing_watermark_as_window_start(monkeypatch):
    conn, _cursor = _mock_conn()
    _patch_db_helpers(
        monkeypatch,
        existing_watermarks={6: "2026-08-01T00:00:00"},
        bootstrap_date=date(2026, 1, 1),
    )

    fake_client = MagicMock()
    fake_client.iter_atualizacao_pages.return_value = [_atualizacao_page([])]

    sync_incremental_module.sync_incremental(
        conn,
        modalidades=[6],
        client=fake_client,
        detalhes_client=MagicMock(),
        until=date(2026, 8, 2),
    )

    fake_client.iter_atualizacao_pages.assert_called_once_with(
        data_inicial="20260801", data_final="20260802", codigo_modalidade_contratacao=6
    )
