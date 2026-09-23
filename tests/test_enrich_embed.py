"""Unit tests for src/lixto/enrich/embed.py — mocked psycopg + mocked LlmClient."""

from unittest.mock import MagicMock

from lixto.enrich import embed
from lixto.enrich.embed import (
    BATCH_SIZE,
    MAX_ITEMS,
    build_embedding_text,
    build_ingested_embedding_text,
    embed_ingested,
    embed_pending,
    to_pgvector,
)


def _row(procurement_id=1):
    return {
        "procurement_id": procurement_id,
        "summary": "Compra de lápis.",
        "concepts": ["lapis"],
        "keywords": ["lapis", "lapis preto"],
        "categories": ["material escolar"],
    }


def _conn(rows):
    """Cursor order inside embed_pending: select (dict_row), then one cursor
    per batch of upserts."""
    select_cur = MagicMock()
    select_cur.fetchall.return_value = rows
    update_curs = [MagicMock() for _ in range(1 + len(rows) // max(BATCH_SIZE, 1))]

    conn = MagicMock()
    conn.cursor.return_value.__enter__.side_effect = [select_cur, *update_curs]
    conn.cursor.return_value.__exit__.return_value = False
    return conn, select_cur, update_curs


def _llm(dims=4):
    llm = MagicMock()
    llm.embed.side_effect = lambda texts: ([[0.5] * dims for _ in texts], "embed-model")
    return llm


# --- build_embedding_text ------------------------------------------------


def test_build_embedding_text_joins_all_parts_in_order():
    assert build_embedding_text(_row()) == (
        "Compra de lápis.\nlapis\nlapis, lapis preto\nmaterial escolar"
    )


def test_build_embedding_text_skips_empty_parts():
    row = {"summary": None, "concepts": [], "keywords": ["lapis"], "categories": []}
    assert build_embedding_text(row) == "lapis"


def test_build_embedding_text_of_empty_payload_is_empty():
    assert build_embedding_text({}) == ""


def test_build_embedding_text_is_deterministic():
    assert build_embedding_text(_row()) == build_embedding_text(_row())


# --- to_pgvector ---------------------------------------------------------


def test_to_pgvector_formats_bracketed_csv():
    assert to_pgvector([0.5, -1.0, 2.0]) == "[0.5,-1.0,2.0]"


def test_to_pgvector_of_empty_vector():
    assert to_pgvector([]) == "[]"


# --- embed_pending -------------------------------------------------------


def test_embed_pending_selects_done_enrichments_without_an_embeddings_row():
    conn, select_cur, _ = _conn([])

    result = embed_pending(conn, limit=10, llm=_llm())

    assert result == {"processed": 0, "embedded": 0, "error": 0}
    sql = select_cur.execute.call_args.args[0]
    assert "e.status = 'done'" in sql
    assert "FROM procurement_embeddings pe" in sql
    assert "LEFT JOIN procurement_categories c" in sql
    assert "ORDER BY e.enriched_at DESC" in sql
    assert select_cur.execute.call_args.args[1] == {"limit": 10}


def test_embed_pending_with_nothing_pending_builds_no_llm_client(monkeypatch):
    """No pending rows must not need provider credentials."""
    monkeypatch.setattr(embed, "LlmClient", MagicMock(side_effect=AssertionError("client built")))
    conn, _select_cur, _update_curs = _conn([])

    assert embed_pending(conn) == {"processed": 0, "embedded": 0, "error": 0}


def test_embed_pending_batches_rows_into_one_embed_call():
    rows = [_row(1), _row(2), _row(3)]
    conn, _select_cur, update_curs = _conn(rows)
    llm = _llm()

    result = embed_pending(conn, llm=llm)

    assert result == {"processed": 3, "embedded": 3, "error": 0}
    assert llm.embed.call_count == 1
    assert llm.embed.call_args.args[0] == [build_embedding_text(r) for r in rows]
    assert update_curs[0].execute.call_count == 3
    conn.commit.assert_called_once()


def test_embed_pending_upserts_carry_vector_model_and_procurement_id():
    conn, _select_cur, update_curs = _conn([_row(42)])

    embed_pending(conn, llm=_llm())

    sql, params = update_curs[0].execute.call_args.args
    assert "INSERT INTO procurement_embeddings" in sql
    assert "%(embedding)s::vector" in sql
    assert "ON CONFLICT (procurement_id) DO UPDATE" in sql
    assert params == {
        "procurement_id": 42,
        "model": "embed-model",
        "embedding": "[0.5,0.5,0.5,0.5]",
    }


def test_embed_pending_splits_into_batches_of_batch_size():
    rows = [_row(i) for i in range(BATCH_SIZE + 5)]
    conn, _select_cur, _update_curs = _conn(rows)
    llm = _llm()

    result = embed_pending(conn, llm=llm)

    assert llm.embed.call_count == 2
    assert len(llm.embed.call_args_list[0].args[0]) == BATCH_SIZE
    assert len(llm.embed.call_args_list[1].args[0]) == 5
    assert result["embedded"] == BATCH_SIZE + 5
    assert conn.commit.call_count == 2


def test_embed_pending_stops_on_sdk_error_without_marking_rows():
    rows = [_row(1), _row(2)]
    conn, _select_cur, update_curs = _conn(rows)
    llm = MagicMock()
    llm.embed.side_effect = RuntimeError("provider exploded")

    result = embed_pending(conn, llm=llm)

    assert result == {"processed": 2, "embedded": 0, "error": 2}
    update_curs[0].execute.assert_not_called()
    conn.commit.assert_not_called()


def test_embed_pending_second_batch_error_keeps_first_batch():
    rows = [_row(i) for i in range(BATCH_SIZE + 3)]
    conn, _select_cur, _update_curs = _conn(rows)
    llm = MagicMock()
    llm.embed.side_effect = [
        ([[0.5] * 4] * BATCH_SIZE, "embed-model"),
        RuntimeError("provider exploded"),
    ]

    result = embed_pending(conn, llm=llm)

    assert result == {"processed": BATCH_SIZE + 3, "embedded": BATCH_SIZE, "error": 3}
    conn.commit.assert_called_once()


def test_embed_pending_fills_the_run_counters():
    from lixto.runs import RunCounters

    conn, _select_cur, _update_curs = _conn([_row(1)])
    counters = RunCounters()

    embed_pending(conn, llm=_llm(), counters=counters)

    assert counters.as_dict() == {"processed": 1, "embedded": 1, "error": 0}


# --- embed_ingested (raw PNCP text for unanalysed open tenders) -----------


def _ingested_row(procurement_id=1):
    return {
        "procurement_id": procurement_id,
        "description": "Aquisição de notebooks para a secretaria.",
        "items": ["Mouse óptico", "Notebook 16GB"],
    }


def test_build_ingested_embedding_text_joins_object_and_items():
    assert build_ingested_embedding_text(_ingested_row()) == (
        "Aquisição de notebooks para a secretaria.\nMouse óptico; Notebook 16GB"
    )


def test_build_ingested_embedding_text_skips_blank_parts():
    row = {"description": "  ", "items": ["", " Cadeira "]}
    assert build_ingested_embedding_text(row) == "Cadeira"
    assert build_ingested_embedding_text({"description": "Obra", "items": None}) == "Obra"


def test_embed_ingested_selects_open_unanalysed_unembedded_tenders():
    conn, select_cur, _ = _conn([])

    result = embed_ingested(conn, limit=7, llm=_llm())

    assert result == {"ingested_processed": 0, "ingested_embedded": 0, "ingested_error": 0}
    sql, params = select_cur.execute.call_args.args
    assert "proposal_closes_at >= now() OR p.proposal_opens_at > now()" in sql
    assert "FROM procurement_embeddings pe" in sql
    assert "e.status = 'done'" in sql
    assert "FROM procurement_items i" in sql
    assert "p.status_id = %(active_status_id)s" in sql
    assert "ORDER BY p.published_at DESC NULLS LAST" in sql
    assert params == {"limit": 7, "max_items": MAX_ITEMS, "active_status_id": 1}


def test_embed_ingested_with_nothing_pending_builds_no_llm_client(monkeypatch):
    monkeypatch.setattr(embed, "LlmClient", MagicMock(side_effect=AssertionError("client built")))
    conn, _select_cur, _update_curs = _conn([])

    embed_ingested(conn)


def test_embed_ingested_upserts_raw_text_vectors():
    rows = [_ingested_row(5), _ingested_row(6)]
    conn, _select_cur, update_curs = _conn(rows)
    llm = _llm()

    result = embed_ingested(conn, llm=llm)

    assert result == {"ingested_processed": 2, "ingested_embedded": 2, "ingested_error": 0}
    assert llm.embed.call_args.args[0] == [build_ingested_embedding_text(r) for r in rows]
    sql, params = update_curs[0].execute.call_args.args
    assert "ON CONFLICT (procurement_id) DO UPDATE" in sql
    assert params["procurement_id"] == 6
    conn.commit.assert_called_once()


def test_embed_ingested_stops_on_sdk_error():
    conn, _select_cur, update_curs = _conn([_ingested_row(1)])
    llm = MagicMock()
    llm.embed.side_effect = RuntimeError("provider exploded")

    result = embed_ingested(conn, llm=llm)

    assert result == {"ingested_processed": 1, "ingested_embedded": 0, "ingested_error": 1}
    update_curs[0].execute.assert_not_called()
    conn.commit.assert_not_called()


def test_both_passes_share_one_run_counters_without_clashing():
    from lixto.runs import RunCounters

    counters = RunCounters()
    conn, _s, _u = _conn([_row(1)])
    embed_pending(conn, llm=_llm(), counters=counters)
    conn2, _s2, _u2 = _conn([_ingested_row(2), _ingested_row(3)])
    embed_ingested(conn2, llm=_llm(), counters=counters)

    assert counters.as_dict() == {
        "processed": 1,
        "embedded": 1,
        "error": 0,
        "ingested_processed": 2,
        "ingested_embedded": 2,
        "ingested_error": 0,
    }


# --- CLI -----------------------------------------------------------------


def _run_cli(monkeypatch, analysed, ingested):
    from contextlib import contextmanager

    from typer.testing import CliRunner

    from lixto.cli import app as root_app
    from lixto.cli import enrich as cli_enrich

    @contextmanager
    def fake_run(_conn, _kind):
        yield {}

    monkeypatch.setattr(cli_enrich.db, "get_connection", lambda: MagicMock())
    monkeypatch.setattr(cli_enrich.runs, "run", fake_run)
    monkeypatch.setattr(cli_enrich, "embed_pending", lambda *a, **k: analysed)
    monkeypatch.setattr(cli_enrich, "embed_ingested", lambda *a, **k: ingested)
    return CliRunner().invoke(root_app, ["enrich", "embed", "--limit", "10"])


def test_cli_embed_reports_both_passes(monkeypatch):
    result = _run_cli(
        monkeypatch,
        {"processed": 1, "embedded": 1, "error": 0},
        {"ingested_processed": 3, "ingested_embedded": 3, "ingested_error": 0},
    )
    assert result.exit_code == 0
    assert "embeddings (analysed): 1 processed (1 ok, 0 error)" in result.output
    assert "embeddings (ingested): 3 processed (3 ok, 0 error)" in result.output


def test_cli_embed_fails_when_every_call_errored(monkeypatch):
    result = _run_cli(
        monkeypatch,
        {"processed": 0, "embedded": 0, "error": 0},
        {"ingested_processed": 50, "ingested_embedded": 0, "ingested_error": 50},
    )
    assert result.exit_code == 1
