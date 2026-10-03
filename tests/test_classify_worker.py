"""Unit tests for src/lixto/classify/worker.py — mocked connection and LLM,
no database, no network."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from lixto.classify import worker

CNAE_CANDS = [("6201501", "Desenvolvimento de programas", 0.9)]
SEG_CANDS = [("informatica", "Informática", "TI", 0.8), ("outros", "Outros", "Resto", 0.0)]

ROW = {
    "procurement_id": 7,
    "description": "Contratação de software",
    "embedding": "[0.1,0.2]",
    "items": ["licença"],
}


def _usage(calls=0):
    return {
        "calls": calls,
        "prompt_tokens": 100 * calls,
        "completion_tokens": 10 * calls,
        "est_usd_micros": 50 * calls,
        "unpriced_models": [],
    }


def _llm(payload, calls=1):
    llm = MagicMock()
    llm.complete_json_text.return_value = (payload, "cheap-model")
    llm.usage_summary.return_value = _usage(calls)
    return llm


def _good_payload():
    return {
        "cnaes": [{"code": "6201501", "confidence": 0.9}],
        "segment": "informatica",
        "segment_confidence": 0.8,
        "nature": "servicos",
        "keywords": ["software"],
    }


@pytest.fixture
def candidates(monkeypatch):
    monkeypatch.setattr(worker, "_fetch_candidates", lambda conn, v: (CNAE_CANDS, SEG_CANDS))


def _conn():
    cur = MagicMock()
    conn = MagicMock()
    conn.cursor.return_value.__enter__.return_value = cur
    conn.cursor.return_value.__exit__.return_value = False
    return conn, cur


def _sqls(cur):
    return [c.args[0] for c in cur.execute.call_args_list]


def test_done_path_replaces_ingest_cnaes_and_upserts(candidates):
    conn, cur = _conn()
    llm = _llm(_good_payload())

    outcome = worker.classify_one(conn, ROW, llm=llm)

    assert outcome == "done"
    sqls = _sqls(cur)
    assert "origin = 'ingest'" in sqls[0] and sqls[0].startswith("DELETE FROM procurement_cnaes")
    assert "'ingest'" in sqls[1] and "INSERT INTO procurement_cnaes" in sqls[1]
    assert "INSERT INTO procurement_classifications" in sqls[2]
    insert_params = cur.execute.call_args_list[1].args[1]
    assert insert_params == {"id": 7, "code": "6201501", "confidence": 0.9}
    upsert = cur.execute.call_args_list[2].args[1]
    assert upsert["status"] == "done"
    assert upsert["segment_source"] == "llm"
    assert upsert["nature"] == "servicos"
    assert upsert["model"] == "cheap-model"
    conn.commit.assert_called_once()
    assert llm.complete_json_text.call_args.kwargs["tier"] == "cheap"


def test_none_payload_is_an_error_row_without_cnae_writes(candidates):
    conn, cur = _conn()

    outcome = worker.classify_one(conn, ROW, llm=_llm(None))

    assert outcome == "error"
    sqls = _sqls(cur)
    assert not any("procurement_cnaes" in s for s in sqls)
    assert len(sqls) == 1
    assert cur.execute.call_args_list[0].args[1]["status"] == "error"
    assert cur.execute.call_args_list[0].args[1]["error"]


def test_invalid_nature_is_an_error_row(candidates):
    conn, cur = _conn()
    payload = {**_good_payload(), "nature": "misto"}

    assert worker.classify_one(conn, ROW, llm=_llm(payload)) == "error"
    assert not any("procurement_cnaes" in s for s in _sqls(cur))


def test_empty_cnae_embeddings_refuse_to_start():
    conn, cur = _conn()
    cur.fetchone.return_value = (0, 0)
    llm = _llm(None, calls=0)

    with pytest.raises(RuntimeError, match="embed-labels"):
        worker.classify(conn, llm=llm)

    llm.complete_json_text.assert_not_called()


def test_segment_without_embedding_refuses_to_start():
    conn, cur = _conn()
    cur.fetchone.return_value = (100, 3)

    with pytest.raises(RuntimeError):
        worker.classify(conn, llm=_llm(None, calls=0))


def test_cap_reached_makes_no_llm_calls(monkeypatch):
    monkeypatch.setenv("LIXTO_CLASSIFY_DAILY_CAP", "5")
    conn, cur = _conn()
    cur.fetchone.side_effect = [(100, 0), (5,)]
    llm = _llm(None, calls=0)

    result = worker.classify(conn, llm=llm)

    assert result["cap_reached"] == 1
    assert result["cap"] == 5
    assert result["used_today_at_start"] == 5
    assert result["processed"] == 0
    llm.complete_json_text.assert_not_called()


def test_classify_counts_rows_and_llm_usage(monkeypatch, candidates):
    monkeypatch.delenv("LIXTO_CLASSIFY_DAILY_CAP", raising=False)
    conn, cur = _conn()
    cur.fetchone.side_effect = [(100, 0)]
    cur.fetchall.return_value = [ROW, {**ROW, "procurement_id": 8}]
    llm = MagicMock()
    llm.complete_json_text.side_effect = [(_good_payload(), "m"), (None, "m")]
    llm.usage_summary.return_value = _usage(2)

    result = worker.classify(conn, llm=llm)

    assert result["processed"] == 2
    assert result["classified"] == 1
    assert result["error"] == 1
    assert result["llm_calls"] == 2
    assert result["llm_prompt_tokens"] == 200
    assert result["llm_completion_tokens"] == 20
    assert result["llm_est_usd_micros"] == 100
    assert result["est_usd"] == pytest.approx(0.0001)


def test_llm_exception_stops_the_run(monkeypatch, candidates):
    monkeypatch.delenv("LIXTO_CLASSIFY_DAILY_CAP", raising=False)
    conn, cur = _conn()
    cur.fetchone.side_effect = [(100, 0)]
    cur.fetchall.return_value = [ROW, {**ROW, "procurement_id": 8}]
    llm = MagicMock()
    llm.complete_json_text.side_effect = RuntimeError("provider down")
    llm.usage_summary.return_value = _usage(0)

    result = worker.classify(conn, llm=llm)

    assert llm.complete_json_text.call_count == 1
    assert result["processed"] == 1
    assert result["error"] == 1
    conn.rollback.assert_called()


def test_modalities_env_parsing(monkeypatch):
    monkeypatch.delenv("LIXTO_CLASSIFY_MODALITIES", raising=False)
    assert worker._modalities() == [6, 8]
    monkeypatch.setenv("LIXTO_CLASSIFY_MODALITIES", "6, 7,x")
    assert worker._modalities() == [6, 7]
