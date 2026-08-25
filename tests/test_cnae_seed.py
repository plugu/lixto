"""Unit tests for `lixto.cnae_seed`.

No live network or database: httpx calls go through a MockTransport and the
Postgres connection is a MagicMock.
"""

from unittest.mock import MagicMock

import httpx

from lixto.cnae_seed import entry_to_row, fetch_subclasses, seed

FIXTURE_ENTRIES = [
    {
        "id": "6201500",
        "descricao": "Desenvolvimento de programas de computador sob encomenda",
        "classe": {
            "id": "6201-5",
            "descricao": "Desenvolvimento de programas de computador sob encomenda",
            "grupo": {
                "id": "620",
                "descricao": "Atividades dos serviços de tecnologia da informação",
                "divisao": {
                    "id": "62",
                    "descricao": "Atividades dos serviços de tecnologia da informação",
                },
            },
        },
    },
    {
        "id": "4711301",
        "descricao": "Comércio varejista de mercadorias em geral - hipermercados",
        "classe": {
            "id": "4711-3",
            "descricao": "Comércio varejista não especializado",
            "grupo": {
                "id": "471",
                "descricao": "Comércio varejista não especializado",
                "divisao": {
                    "id": "47",
                    "descricao": "Comércio varejista",
                },
            },
        },
    },
]


def test_entry_to_row_maps_fields_to_english_columns():
    row = entry_to_row(FIXTURE_ENTRIES[0])
    assert row == {
        "code": "6201500",
        "description": "Desenvolvimento de programas de computador sob encomenda",
        "division": "62",
        "division_description": "Atividades dos serviços de tecnologia da informação",
    }


def test_entry_to_row_second_fixture():
    row = entry_to_row(FIXTURE_ENTRIES[1])
    assert row["code"] == "4711301"
    assert row["division"] == "47"
    assert row["division_description"] == "Comércio varejista"


def _mock_client(json_body):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=json_body)

    return httpx.Client(transport=httpx.MockTransport(handler))


def test_fetch_subclasses_returns_json_array():
    client = _mock_client(FIXTURE_ENTRIES)
    entries = fetch_subclasses(client)
    assert entries == FIXTURE_ENTRIES
    client.close()


def _mock_connection():
    cursor = MagicMock()
    conn = MagicMock()
    conn.cursor.return_value.__enter__.return_value = cursor
    conn.cursor.return_value.__exit__.return_value = False
    return conn, cursor


def test_seed_upserts_every_row_into_cnae_codes_and_commits():
    conn, cursor = _mock_connection()
    client = _mock_client(FIXTURE_ENTRIES)

    result = seed(conn, client=client)

    assert result == {"seeded": 2}
    assert cursor.execute.call_count == 2
    sql = cursor.execute.call_args_list[0].args[0]
    assert "INSERT INTO cnae_codes" in sql
    assert "ON CONFLICT (code) DO UPDATE" in sql
    executed_params = [call.args[1] for call in cursor.execute.call_args_list]
    assert {
        "code": "6201500",
        "description": FIXTURE_ENTRIES[0]["descricao"],
        "division": "62",
        "division_description": "Atividades dos serviços de tecnologia da informação",
    } in executed_params
    conn.commit.assert_called_once()
    client.close()


def test_seed_owns_and_closes_client_when_none_given(monkeypatch):
    conn, _cursor = _mock_connection()

    created_clients = []

    class FakeClient:
        def __init__(self):
            self.closed = False
            created_clients.append(self)

        def get(self, url, timeout=None):
            return httpx.Response(200, json=FIXTURE_ENTRIES, request=httpx.Request("GET", url))

        def close(self):
            self.closed = True

    monkeypatch.setattr("lixto.cnae_seed.httpx.Client", FakeClient)

    result = seed(conn)

    assert result == {"seeded": 2}
    assert created_clients[0].closed is True
