"""Unit tests for src/lixto/enrich/embed.py — mocked psycopg + mocked LlmClient."""

from unittest.mock import MagicMock

from lixto.enrich import embed
from lixto.enrich.embed import BATCH_SIZE, build_embedding_text, embed_pending, to_pgvector


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
