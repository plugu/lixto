import httpx

from plic.cnae_match import (
    build_stage1_prompt,
    build_stage2_prompt,
    classify,
    parse_stage1_response,
    parse_stage2_response,
)

DIVISIONS = [
    {"divisao": "47", "divisao_descricao": "Comércio varejista"},
    {"divisao": "62", "divisao_descricao": "Tecnologia da informação"},
]


# --- stage 1: prompt builder -------------------------------------------------


def test_build_stage1_prompt_lists_divisions_and_numbers_rows():
    rows = [
        {"objeto": "Aquisição de licenças de software", "itens": "LICENCA; SUPORTE"},
        {"objeto": "Compra de material de escritório", "itens": None},
    ]
    prompt = build_stage1_prompt(DIVISIONS, rows)
    assert "47 — Comércio varejista" in prompt
    assert "62 — Tecnologia da informação" in prompt
    assert "1. Objeto: Aquisição de licenças de software Itens: LICENCA; SUPORTE" in prompt
    assert "2. Objeto: Compra de material de escritório" in prompt


# --- stage 1: response parser -----------------------------------------------


def test_parse_stage1_response_plain_array():
    content = '[{"n":1,"divisoes":["47","62"]},{"n":2,"divisoes":["47"]}]'
    assert parse_stage1_response(content, expected=2, valid_divisoes={"47", "62"}) == {
        1: ["47", "62"],
        2: ["47"],
    }


def test_parse_stage1_response_tolerates_fences_and_prose():
    content = 'Segue:\n```json\n[{"n":1,"divisoes":["62"]}]\n```\nOk.'
    assert parse_stage1_response(content, expected=1, valid_divisoes={"62"}) == {1: ["62"]}


def test_parse_stage1_response_drops_unknown_divisions_and_bad_n_dedupes_and_caps():
    content = (
        '[{"n":1,"divisoes":["47","99","47","62","01","10","20"]},'
        '{"n":99,"divisoes":["47"]},{"n":"x","divisoes":["47"]}]'
    )
    result = parse_stage1_response(
        content, expected=1, valid_divisoes={"47", "62", "01", "10", "20"}
    )
    assert result == {1: ["47", "62", "01", "10"]}  # dedup + capped at 4, unknown "99" dropped


def test_parse_stage1_response_garbage_returns_empty():
    assert parse_stage1_response("sem json", expected=3, valid_divisoes={"47"}) == {}
    assert parse_stage1_response("[invalido", expected=3, valid_divisoes={"47"}) == {}
    assert parse_stage1_response('{"n":1}', expected=3, valid_divisoes={"47"}) == {}


# --- stage 2: prompt builder -------------------------------------------------


def test_build_stage2_prompt_lists_subclasses_and_objeto():
    subclasses = [
        {"codigo": "6201500", "descricao": "Desenvolvimento de programas sob encomenda"},
        {"codigo": "6202300", "descricao": "Desenvolvimento e licenciamento de programas"},
    ]
    row = {"objeto": "Contratação de fábrica de software", "itens": "DESENVOLVIMENTO"}
    prompt = build_stage2_prompt(row, subclasses)
    assert "6201500 — Desenvolvimento de programas sob encomenda" in prompt
    assert "6202300 — Desenvolvimento e licenciamento de programas" in prompt
    assert "Objeto: Contratação de fábrica de software" in prompt
    assert "Itens: DESENVOLVIMENTO" in prompt


# --- stage 2: response parser -----------------------------------------------


def test_parse_stage2_response_valid_entries():
    content = '[{"codigo":"6201500","confidence":0.8},{"codigo":"6202300","confidence":0.2}]'
    assert parse_stage2_response(content, valid_codes={"6201500", "6202300"}) == [
        {"codigo": "6201500", "confidence": 0.8},
        {"codigo": "6202300", "confidence": 0.2},
    ]


def test_parse_stage2_response_drops_unknown_codigo_and_dedupes():
    content = (
        '[{"codigo":"9999999","confidence":0.9},{"codigo":"6201500","confidence":0.5},'
        '{"codigo":"6201500","confidence":0.1}]'
    )
    assert parse_stage2_response(content, valid_codes={"6201500"}) == [
        {"codigo": "6201500", "confidence": 0.5}
    ]


def test_parse_stage2_response_invalid_confidence_becomes_none_but_codigo_kept():
    content = '[{"codigo":"6201500","confidence":"alta"},{"codigo":"6202300","confidence":1.5}]'
    assert parse_stage2_response(content, valid_codes={"6201500", "6202300"}) == [
        {"codigo": "6201500", "confidence": None},
        {"codigo": "6202300", "confidence": None},
    ]


def test_parse_stage2_response_empty_array():
    assert parse_stage2_response("[]", valid_codes={"6201500"}) == []


def test_parse_stage2_response_garbage_returns_empty():
    assert parse_stage2_response("sem json aqui", valid_codes={"6201500"}) == []
    assert parse_stage2_response("[invalido", valid_codes={"6201500"}) == []


# --- orchestration -----------------------------------------------------------


class FakeResponse:
    def __init__(self, content: str):
        self._content = content

    def raise_for_status(self) -> None:
        pass

    def json(self) -> dict:
        return {"choices": [{"message": {"content": self._content}}]}


class FakeHTTPClient:
    """Returns/raises the next scripted item on every .post() call, in order.
    Stage 1 is called once per batch, then stage 2 once per row that has
    candidate divisions — so the script order encodes call order."""

    def __init__(self, script: list):
        self.script = list(script)
        self.calls = 0

    def post(self, url, json=None, timeout=None):
        self.calls += 1
        item = self.script.pop(0)
        if isinstance(item, Exception):
            raise item
        return FakeResponse(item)


class FakeCursor:
    def __init__(self, conn):
        self.conn = conn
        self._result = []

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, params=None):
        self.conn.executed.append((sql, params))
        if "SELECT DISTINCT divisao" in sql:
            self._result = self.conn.divisions
        elif "FROM licitacao l" in sql:
            self._result = self.conn.batches.pop(0) if self.conn.batches else []
        elif "FROM cnae WHERE divisao" in sql:
            wanted = set(params["divisoes"])
            self._result = [s for s in self.conn.subclasses if s["divisao"] in wanted]
        elif "INSERT INTO licitacao_cnae" in sql:
            self.conn.inserted_tags.append(params)
        elif "UPDATE licitacao SET cnae_classificado_em" in sql:
            self.conn.stamped.append(params["numero"])

    def fetchall(self):
        return self._result


class FakeConn:
    def __init__(self, divisions, batches, subclasses):
        self.divisions = divisions
        self.batches = batches
        self.subclasses = subclasses
        self.executed: list = []
        self.inserted_tags: list = []
        self.stamped: list = []
        self.commits = 0

    def cursor(self, row_factory=None):
        return FakeCursor(self)

    def commit(self):
        self.commits += 1


ROW1 = {"numero_controle_pncp": "L1", "objeto": "Sistema de gestão", "itens": None}
ROW2 = {"numero_controle_pncp": "L2", "objeto": "Outro objeto", "itens": None}
SUBCLASS = {"codigo": "6201500", "descricao": "Dev sob encomenda", "divisao": "62"}


def test_classify_happy_path_inserts_tags_and_stamps():
    conn = FakeConn(divisions=DIVISIONS, batches=[[ROW1], []], subclasses=[SUBCLASS])
    client = FakeHTTPClient(
        [
            '[{"n":1,"divisoes":["62"]}]',
            '[{"codigo":"6201500","confidence":0.9}]',
        ]
    )

    result = classify(conn, client=client)

    assert result == {"processed": 1, "tagged": 1, "tags": 1}
    assert conn.inserted_tags == [{"numero": "L1", "codigo": "6201500", "confidence": 0.9}]
    assert conn.stamped == ["L1"]
    assert conn.commits == 1


def test_classify_empty_stage2_still_stamps_row():
    conn = FakeConn(divisions=DIVISIONS, batches=[[ROW1], []], subclasses=[SUBCLASS])
    client = FakeHTTPClient(['[{"n":1,"divisoes":["62"]}]', "[]"])

    result = classify(conn, client=client)

    assert result == {"processed": 1, "tagged": 0, "tags": 0}
    assert conn.inserted_tags == []
    assert conn.stamped == ["L1"]


def test_classify_no_candidate_divisions_skips_stage2_call_but_stamps():
    conn = FakeConn(divisions=DIVISIONS, batches=[[ROW1], []], subclasses=[SUBCLASS])
    client = FakeHTTPClient(['[{"n":1,"divisoes":[]}]'])  # only stage 1 call consumed

    result = classify(conn, client=client)

    assert result == {"processed": 1, "tagged": 0, "tags": 0}
    assert conn.stamped == ["L1"]
    assert client.calls == 1


def test_classify_stage1_offline_error_aborts_run_row_unstamped():
    conn = FakeConn(divisions=DIVISIONS, batches=[[ROW1]], subclasses=[SUBCLASS])
    client = FakeHTTPClient([httpx.ConnectError("offline")])

    result = classify(conn, client=client)

    assert result == {"processed": 0, "tagged": 0, "tags": 0, "aborted": 1}
    assert conn.stamped == []
    assert conn.inserted_tags == []


def test_classify_stage2_offline_error_leaves_only_that_row_unstamped():
    conn = FakeConn(divisions=DIVISIONS, batches=[[ROW1, ROW2]], subclasses=[SUBCLASS])
    client = FakeHTTPClient(
        [
            '[{"n":1,"divisoes":["62"]},{"n":2,"divisoes":["62"]}]',
            '[{"codigo":"6201500","confidence":0.5}]',
            httpx.ConnectError("offline"),
        ]
    )

    result = classify(conn, client=client)

    assert result == {"processed": 1, "tagged": 1, "tags": 1, "aborted": 1}
    assert conn.stamped == ["L1"]
    assert conn.inserted_tags == [{"numero": "L1", "codigo": "6201500", "confidence": 0.5}]


def test_classify_no_pending_rows_is_a_noop():
    conn = FakeConn(divisions=DIVISIONS, batches=[[]], subclasses=[SUBCLASS])
    client = FakeHTTPClient([])

    result = classify(conn, client=client)

    assert result == {"processed": 0, "tagged": 0, "tags": 0}
    assert client.calls == 0
