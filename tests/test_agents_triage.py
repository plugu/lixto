"""Unit tests for src/plic/agents/triage.py.

Fully mocked psycopg connections/cursors and a mocked OpenAI client — no
network, no live database (mirrors tests/test_classify.py and
tests/test_sync_detalhes.py).
"""

import json
from unittest.mock import MagicMock

from plic.agents.triage import (
    _SELECT_BATCH_SQL,
    PORTAIS_ATIVOS,
    build_instructions,
    build_prompt,
    parse_response,
    triage,
)

PROFILE_TEXT = "## Empresa\nAcme Ltda, fornece TI."


# --- prompt / instructions -------------------------------------------------


def test_build_instructions_includes_profile_text():
    instructions = build_instructions(PROFILE_TEXT)
    assert PROFILE_TEXT in instructions
    assert "fit_score" in instructions


def test_build_prompt_numbers_rows_and_includes_fields():
    rows = [
        {
            "objeto": "Aquisição de notebooks",
            "modalidade_nome": "Pregão Eletrônico",
            "setor": "TI",
            "uf": "SP",
            "municipio_nome": "São Paulo",
            "valor_total_estimado": 100000,
            "itens": "NOTEBOOK; MOUSE",
        },
        {"objeto": "Pavimentação de vias", "itens": None},
    ]
    prompt = build_prompt(rows)
    assert "1. Objeto: Aquisição de notebooks" in prompt
    assert "Modalidade: Pregão Eletrônico" in prompt
    assert "UF: SP" in prompt
    assert "Itens: NOTEBOOK; MOUSE" in prompt
    assert "2. Objeto: Pavimentação de vias" in prompt


# --- response parsing --------------------------------------------------


def test_parse_response_valid_entries():
    content = json.dumps(
        {
            "results": [
                {"n": 1, "fit_score": 80, "verdict": "fit", "reasoning": "Bate com TI."},
                {"n": 2, "fit_score": 10, "verdict": "no_fit", "reasoning": "Fora do ramo."},
            ]
        }
    )
    assert parse_response(content, expected=2) == {
        1: {"fit_score": 80, "verdict": "fit", "reasoning": "Bate com TI."},
        2: {"fit_score": 10, "verdict": "no_fit", "reasoning": "Fora do ramo."},
    }


def test_parse_response_drops_invalid_entries():
    content = json.dumps(
        {
            "results": [
                {"n": 1, "fit_score": 200, "verdict": "fit", "reasoning": "score fora do range"},
                {"n": 99, "fit_score": 50, "verdict": "fit", "reasoning": "n fora do range"},
                {"n": 2, "fit_score": 50, "verdict": "inventado", "reasoning": "verdict inválido"},
                {"n": 3, "fit_score": 50, "verdict": "fit", "reasoning": "ok"},
            ]
        }
    )
    assert parse_response(content, expected=3) == {
        3: {"fit_score": 50, "verdict": "fit", "reasoning": "ok"}
    }


def test_parse_response_garbage_returns_empty():
    assert parse_response("not json", expected=2) == {}
    assert parse_response("[1,2]", expected=2) == {}
    assert parse_response('{"results": "nope"}', expected=2) == {}


def test_parse_response_truncates_long_reasoning():
    content = json.dumps(
        {"results": [{"n": 1, "fit_score": 50, "verdict": "borderline", "reasoning": "x" * 400}]}
    )
    result = parse_response(content, expected=1)
    assert len(result[1]["reasoning"]) == 300


# --- selection SQL -----------------------------------------------------


def test_select_sql_filters_by_allowlist_no_analise_and_date():
    assert "l.usuario_nome = ANY(%(portais)s)" in _SELECT_BATCH_SQL
    assert "NOT EXISTS" in _SELECT_BATCH_SQL
    assert "a.numero_controle_pncp = l.numero_controle_pncp" in _SELECT_BATCH_SQL
    assert (
        "l.data_encerramento_proposta >= now() OR l.data_abertura_proposta > now()"
        in _SELECT_BATCH_SQL
    )
    assert len(PORTAIS_ATIVOS) == 7


# --- triage() orchestration ---------------------------------------------


def _row(numero, objeto="Objeto qualquer"):
    return {
        "numero_controle_pncp": numero,
        "objeto": objeto,
        "modalidade_nome": "Pregão Eletrônico",
        "setor": "TI",
        "uf": "SP",
        "municipio_nome": "São Paulo",
        "valor_total_estimado": 100000,
        "itens": "ITEM 1",
    }


def _conn_with_batches(batches):
    """MagicMock connection: successive select-cursor calls return each
    element of `batches` (list of row-lists); update cursors are separate
    MagicMocks so executed INSERTs can be inspected."""
    select_cursors = [MagicMock() for _ in batches]
    for cur, rows in zip(select_cursors, batches):
        cur.fetchall.return_value = rows

    update_cursor = MagicMock()

    # Interleave: select, update, select, update, ... matching the
    # select-then-insert-cursor pattern in triage().
    side_effect = []
    for cur in select_cursors:
        side_effect.append(cur)
        side_effect.append(update_cursor)

    conn = MagicMock()
    conn.cursor.return_value.__enter__.side_effect = side_effect
    conn.cursor.return_value.__exit__.return_value = False
    return conn, select_cursors, update_cursor


def _fake_client(results_by_batch):
    """OpenAI client mock whose .responses.create returns, in order, a
    response object with output_text = json.dumps(results_by_batch[i])."""
    client = MagicMock()
    responses = [MagicMock(output_text=json.dumps(r)) for r in results_by_batch]
    client.responses.create.side_effect = responses
    return client


def test_triage_persists_scores_and_stops_when_drained():
    rows_batch1 = [_row("num-1"), _row("num-2")]
    conn, _select_cursors, update_cursor = _conn_with_batches([rows_batch1, []])

    client = _fake_client(
        [
            {
                "results": [
                    {"n": 1, "fit_score": 90, "verdict": "fit", "reasoning": "bom encaixe"},
                    {"n": 2, "fit_score": 5, "verdict": "no_fit", "reasoning": "fora do ramo"},
                ]
            }
        ]
    )

    result = triage(conn, client=client, profile_text=PROFILE_TEXT)

    assert result == {"processed": 2, "triaged": 2}
    assert update_cursor.execute.call_count == 2
    first_params = update_cursor.execute.call_args_list[0].args[1]
    assert first_params["numero"] == "num-1"
    assert first_params["fit_score"] == 90
    assert first_params["verdict"] == "fit"
    assert first_params["model"]
    conn.commit.assert_called()


def test_triage_respects_limit():
    rows_batch1 = [_row("num-1")]
    conn, select_cursors, _update_cursor = _conn_with_batches([rows_batch1])

    client = _fake_client(
        [{"results": [{"n": 1, "fit_score": 50, "verdict": "borderline", "reasoning": "ok"}]}]
    )

    result = triage(conn, limit=1, client=client, profile_text=PROFILE_TEXT)

    assert result == {"processed": 1, "triaged": 1}
    _executed_sql, executed_params = select_cursors[0].execute.call_args.args
    assert executed_params["limit"] == 1


def test_triage_skips_unparseable_entries_leaving_them_queued():
    rows_batch1 = [_row("num-1"), _row("num-2")]
    conn, _select_cursors, update_cursor = _conn_with_batches([rows_batch1, []])

    # n=1 is malformed (bad verdict) -> skipped; n=2 is valid.
    client = _fake_client(
        [
            {
                "results": [
                    {"n": 1, "fit_score": 50, "verdict": "talvez", "reasoning": "invalido"},
                    {"n": 2, "fit_score": 70, "verdict": "fit", "reasoning": "valido"},
                ]
            }
        ]
    )

    result = triage(conn, client=client, profile_text=PROFILE_TEXT)

    assert result == {"processed": 2, "triaged": 1}
    assert update_cursor.execute.call_count == 1
    inserted_params = update_cursor.execute.call_args_list[0].args[1]
    assert inserted_params["numero"] == "num-2"


def test_triage_stops_run_on_api_error_without_marking_rows():
    rows_batch1 = [_row("num-1")]
    conn, _select_cursors, update_cursor = _conn_with_batches([rows_batch1])

    client = MagicMock()
    client.responses.create.side_effect = RuntimeError("api down")

    result = triage(conn, client=client, profile_text=PROFILE_TEXT)

    assert result == {"processed": 0, "triaged": 0}
    update_cursor.execute.assert_not_called()
    conn.commit.assert_not_called()


def test_triage_second_run_would_query_with_no_analise_predicate_again():
    # Resumability itself is enforced by the SQL predicate (NOT EXISTS on
    # analise), exercised in test_select_sql_filters_by_allowlist_no_analise_and_date.
    # Here we confirm a fresh call re-issues the select from offset 0, so a
    # second `plic agents run` naturally picks up whatever rows still lack
    # an analise row (i.e. different rows than a successful first run, since
    # those now have one).
    rows_batch1 = [_row("num-3")]
    conn, select_cursors, _update_cursor = _conn_with_batches([rows_batch1, []])

    client = _fake_client(
        [{"results": [{"n": 1, "fit_score": 60, "verdict": "borderline", "reasoning": "ok"}]}]
    )

    triage(conn, client=client, profile_text=PROFILE_TEXT)

    executed_params = select_cursors[0].execute.call_args.args[1]
    assert executed_params["offset"] == 0
