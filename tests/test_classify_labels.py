"""Unit tests for src/lixto/classify/labels.py — mocked psycopg + LlmClient."""

from unittest.mock import MagicMock

from lixto.classify import labels
from lixto.classify.labels import BATCH_SIZE, embed_labels, verify_taxonomy
from lixto.classify.taxonomy import SEGMENT_CODES


def _cnae(i):
    return {"code": f"{i:07d}", "description": f"desc {i}", "division_description": "div"}


def _segment(code="saude"):
    return {"code": code, "label": "Saúde", "description": "Medicamentos."}


def _conn(cnaes, segments, extra_cursors=10):
    cnae_cur, seg_cur = MagicMock(), MagicMock()
    cnae_cur.fetchall.return_value = cnaes
    seg_cur.fetchall.return_value = segments
    writers = [MagicMock() for _ in range(extra_cursors)]
    conn = MagicMock()
    conn.cursor.return_value.__enter__.side_effect = [cnae_cur, seg_cur, *writers]
    conn.cursor.return_value.__exit__.return_value = False
    return conn, cnae_cur, seg_cur, writers


def _llm(dims=4):
    llm = MagicMock()
    llm.embed.side_effect = lambda texts: ([[0.5] * dims for _ in texts], "embed-model")
    return llm


def test_embeds_cnaes_and_segments_with_expected_sql_and_texts():
    conn, _, _, writers = _conn([_cnae(1)], [_segment()])
    llm = _llm()
    result = embed_labels(conn, llm=llm)

    assert result == {"cnae_embedded": 1, "segments_embedded": 1}
    assert llm.embed.call_args_list[0].args[0] == ["desc 1 (div)"]
    assert llm.embed.call_args_list[1].args[0] == ["Saúde: Medicamentos."]
    cnae_sql, cnae_params = writers[0].execute.call_args.args
    assert "cnae_code_embeddings" in cnae_sql
    assert cnae_params["embedding"] == "[0.5,0.5,0.5,0.5]"
    seg_sql, seg_params = writers[1].execute.call_args.args
    assert "UPDATE classification_segments" in seg_sql
    assert seg_params["code"] == "saude"
    assert conn.commit.call_count == 2


def test_batches_of_at_most_100():
    rows = [_cnae(i) for i in range(BATCH_SIZE + 5)]
    conn, _, _, _ = _conn(rows, [])
    llm = _llm()
    result = embed_labels(conn, llm=llm)

    assert [len(c.args[0]) for c in llm.embed.call_args_list] == [BATCH_SIZE, 5]
    assert result["cnae_embedded"] == BATCH_SIZE + 5
    assert result["segments_embedded"] == 0


def test_force_selects_all_rows():
    conn, cnae_cur, seg_cur, _ = _conn([], [])
    embed_labels(conn, llm=_llm(), force=True)
    assert cnae_cur.execute.call_args.args[1] == {"force": True}
    assert seg_cur.execute.call_args.args[1] == {"force": True}

    conn, cnae_cur, _, _ = _conn([], [])
    embed_labels(conn, llm=_llm())
    assert cnae_cur.execute.call_args.args[1] == {"force": False}


def test_nothing_pending_needs_no_llm(monkeypatch):
    monkeypatch.setattr(labels, "LlmClient", MagicMock(side_effect=AssertionError("built")))
    conn, _, _, _ = _conn([], [])
    assert embed_labels(conn) == {"cnae_embedded": 0, "segments_embedded": 0}


def test_verify_taxonomy_reports_drift_both_ways():
    conn = MagicMock()
    cur = conn.cursor.return_value.__enter__.return_value
    cur.fetchall.return_value = [(c,) for c in SEGMENT_CODES if c != "outros"] + [("extra",)]
    assert verify_taxonomy(conn) == ["outros", "extra"]

    cur.fetchall.return_value = [(c,) for c in SEGMENT_CODES]
    assert verify_taxonomy(conn) == []
