from plic.classify import SETORES, build_prompt, parse_response


def test_build_prompt_numbers_rows_and_includes_labels():
    rows = [
        {"objeto": "Aquisição de medicamentos", "itens": "DIPIRONA; SORO"},
        {"objeto": "Pavimentação de vias", "itens": None},
    ]
    prompt = build_prompt(rows)
    assert "1. Objeto: Aquisição de medicamentos Itens: DIPIRONA; SORO" in prompt
    assert "2. Objeto: Pavimentação de vias" in prompt
    for setor in SETORES:
        assert setor in prompt


def test_parse_response_plain_array():
    content = '[{"n":1,"setor":"Saúde"},{"n":2,"setor":"Obras e Engenharia"}]'
    assert parse_response(content, expected=2) == {
        1: "Saúde",
        2: "Obras e Engenharia",
    }


def test_parse_response_tolerates_fences_and_prose():
    content = 'Aqui está:\n```json\n[{"n":1,"setor":"TI"}]\n```\nPronto.'
    assert parse_response(content, expected=1) == {1: "TI"}


def test_parse_response_drops_unknown_labels_and_bad_n():
    content = (
        '[{"n":1,"setor":"Setor Inventado"},{"n":99,"setor":"TI"},'
        '{"n":2,"setor":"TI"},"lixo",{"n":"x","setor":"TI"}]'
    )
    assert parse_response(content, expected=2) == {2: "TI"}


def test_parse_response_garbage_returns_empty():
    assert parse_response("sem json aqui", expected=3) == {}
    assert parse_response("[invalido", expected=3) == {}
    assert parse_response('{"n":1}', expected=3) == {}
