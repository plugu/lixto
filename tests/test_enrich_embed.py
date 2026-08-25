"""Unit tests for src/plic/enrich/embed.py — mocked psycopg + mocked LlmClient."""

from unittest.mock import MagicMock

from plic.enrich import embed
from plic.enrich.embed import BATCH_SIZE, build_embedding_text, embed_pending, to_pgvector


def _row(numero="num-1"):
    return {
        "numero_controle_pncp": numero,
        "resumo": "Compra de lápis.",
        "conceitos": ["lapis"],
        "palavras_chave": ["lapis", "lapis preto"],
        "categorias": ["material escolar"],
    }


def _conn(rows):
    """Cursor order inside embed_pending: select (dict_row), then one cursor
    per batch of UPDATEs."""
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
    row = {"resumo": None, "conceitos": [], "palavras_chave": ["lapis"], "categorias": []}
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


def test_embed_pending_selects_done_rows_without_embedding():
    conn, select_cur, _ = _conn([])

    result = embed_pending(conn, limit=10, llm=_llm())

    assert result == {"processed": 0, "embedded": 0, "error": 0}
    sql = select_cur.execute.call_args.args[0]
    assert "status = 'done' AND embedding IS NULL" in sql
    assert "ORDER BY enriquecido_em DESC" in sql
    assert select_cur.execute.call_args.args[1] == {"limit": 10}


def test_embed_pending_with_nothing_pending_builds_no_llm_client(monkeypatch):
    """No pending rows must not need provider credentials."""
    monkeypatch.setattr(embed, "LlmClient", MagicMock(side_effect=AssertionError("client built")))
    conn, _select_cur, _update_curs = _conn([])

    assert embed_pending(conn) == {"processed": 0, "embedded": 0, "error": 0}


def test_embed_pending_batches_rows_into_one_embed_call():
    rows = [_row("num-1"), _row("num-2"), _row("num-3")]
    conn, _select_cur, update_curs = _conn(rows)
    llm = _llm()

    result = embed_pending(conn, llm=llm)

    assert result == {"processed": 3, "embedded": 3, "error": 0}
    assert llm.embed.call_count == 1
    assert llm.embed.call_args.args[0] == [build_embedding_text(r) for r in rows]
    assert update_curs[0].execute.call_count == 3
    conn.commit.assert_called_once()


def test_embed_pending_updates_carry_vector_model_and_numero():
    conn, _select_cur, update_curs = _conn([_row("num-1")])

    embed_pending(conn, llm=_llm())

    sql, params = update_curs[0].execute.call_args.args
    assert "SET embedding = %(embedding)s::vector" in sql
    assert "embedding_em = now()" in sql
    assert params["numero"] == "num-1"
    assert params["modelo"] == "embed-model"
    assert params["embedding"] == "[0.5,0.5,0.5,0.5]"


def test_embed_pending_splits_into_batches_of_batch_size():
    rows = [_row(f"num-{i}") for i in range(BATCH_SIZE + 5)]
    conn, _select_cur, _update_curs = _conn(rows)
    llm = _llm()

    result = embed_pending(conn, llm=llm)

    assert llm.embed.call_count == 2
    assert len(llm.embed.call_args_list[0].args[0]) == BATCH_SIZE
    assert len(llm.embed.call_args_list[1].args[0]) == 5
    assert result["embedded"] == BATCH_SIZE + 5
    assert conn.commit.call_count == 2


def test_embed_pending_stops_on_sdk_error_without_marking_rows():
    rows = [_row("num-1"), _row("num-2")]
    conn, _select_cur, update_curs = _conn(rows)
    llm = MagicMock()
    llm.embed.side_effect = RuntimeError("provider exploded")

    result = embed_pending(conn, llm=llm)

    assert result == {"processed": 2, "embedded": 0, "error": 2}
    update_curs[0].execute.assert_not_called()
    conn.commit.assert_not_called()


def test_embed_pending_second_batch_error_keeps_first_batch():
    rows = [_row(f"num-{i}") for i in range(BATCH_SIZE + 3)]
    conn, _select_cur, _update_curs = _conn(rows)
    llm = MagicMock()
    llm.embed.side_effect = [
        ([[0.5] * 4] * BATCH_SIZE, "embed-model"),
        RuntimeError("provider exploded"),
    ]

    result = embed_pending(conn, llm=llm)

    assert result == {"processed": BATCH_SIZE + 3, "embedded": BATCH_SIZE, "error": 3}
    conn.commit.assert_called_once()
