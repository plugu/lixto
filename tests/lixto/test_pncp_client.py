"""Unit tests for src/lixto/pncp_client.py.

No live network calls: httpx.MockTransport stands in for PNCP, and
time.sleep is monkeypatched to a no-op so retry/backoff/cooldown paths run
instantly. Page bodies are built inline (no fixture files) — the assertions
are about URLs, params and envelope/204 handling, not about DTO contents.
"""

import httpx
import pytest

from lixto import pncp_client
from lixto.pncp_client import PncpApiError, PncpClient

PAGE = {
    "data": [{"numeroControlePNCP": "00000000000191-1-000001/2026"}],
    "totalRegistros": 1,
    "totalPaginas": 1,
    "numeroPagina": 1,
    "paginasRestantes": 0,
    "empty": False,
}


@pytest.fixture(autouse=True)
def _no_sleep(monkeypatch):
    """Every test in this module runs with retry/backoff sleeps stubbed out."""
    monkeypatch.setattr(pncp_client.time, "sleep", lambda _seconds: None)


def _client_with_handler(handler) -> PncpClient:
    return PncpClient(transport=httpx.MockTransport(handler))


# ------------------------------------------------------------------ transport


def test_fetch_publication_page_success_returns_decoded_json():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/consulta/v1/contratacoes/publicacao"
        assert request.url.params["codigoModalidadeContratacao"] == "6"
        assert request.url.params["dataInicial"] == "20260102"
        assert request.url.params["dataFinal"] == "20260103"
        assert request.url.params["tamanhoPagina"] == "50"
        return httpx.Response(200, json=PAGE)

    with _client_with_handler(handler) as client:
        page = client.fetch_publication_page(
            date_from="20260102", date_to="20260103", modality_id=6, page=1
        )

    assert page["totalRegistros"] == 1
    assert len(page["data"]) == 1


def test_retries_on_429_then_succeeds():
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] == 1:
            return httpx.Response(429, text="<html>rate limited</html>")
        return httpx.Response(200, json=PAGE)

    with _client_with_handler(handler) as client:
        page = client.fetch_publication_page(
            date_from="20260102", date_to="20260102", modality_id=6, page=1
        )

    assert calls["n"] == 2
    assert page["totalRegistros"] == 1


def test_retries_on_503_then_succeeds():
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] < 3:
            # 5xx bodies are HTML, never JSON — make sure we don't try to parse them.
            return httpx.Response(503, text="<html>bad gateway</html>")
        return httpx.Response(200, json=PAGE)

    with _client_with_handler(handler) as client:
        page = client.fetch_publication_page(
            date_from="20260102", date_to="20260102", modality_id=6, page=1
        )

    assert calls["n"] == 3
    assert page["totalRegistros"] == 1


def test_does_not_retry_on_400():
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return httpx.Response(400, text="bad request")

    with _client_with_handler(handler) as client, pytest.raises(PncpApiError):
        client.fetch_publication_page(
            date_from="20260102", date_to="20260102", modality_id=6, page=1
        )

    assert calls["n"] == 1


def test_raises_after_exhausting_retries():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, text="<html>server error</html>")

    with _client_with_handler(handler) as client, pytest.raises(PncpApiError):
        client.fetch_publication_page(
            date_from="20260102", date_to="20260102", modality_id=6, page=1
        )


# ------------------------------------------------------- contratações endpoints


def test_fetch_publication_page_204_returns_empty_page_not_error():
    # Verified live (2026-08-01): zero-result queries return HTTP 204 with an
    # empty body rather than 200 + an empty envelope — the client must
    # absorb this centrally, not raise.
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(204)

    with _client_with_handler(handler) as client:
        page = client.fetch_publication_page(
            date_from="20260102", date_to="20260102", modality_id=6, page=1
        )

    assert page == {
        "data": [],
        "totalRegistros": 0,
        "totalPaginas": 0,
        "numeroPagina": 1,
        "paginasRestantes": 0,
        "empty": True,
    }


def test_fetch_update_page_hits_atualizacao_path():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/consulta/v1/contratacoes/atualizacao"
        assert request.url.params["codigoModalidadeContratacao"] == "6"
        return httpx.Response(200, json=PAGE)

    with _client_with_handler(handler) as client:
        page = client.fetch_update_page(
            date_from="20260102", date_to="20260102", modality_id=6, page=1
        )

    assert page["totalRegistros"] == 1


def test_fetch_update_page_204_returns_empty_page():
    # /atualizacao hits 204 constantly on quiet modalidades.
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(204)

    with _client_with_handler(handler) as client:
        page = client.fetch_update_page(
            date_from="20260102", date_to="20260102", modality_id=6, page=1
        )

    assert page["data"] == []
    assert page["paginasRestantes"] == 0


def test_iter_publication_pages_stops_when_no_pages_remaining():
    page1 = {"data": [{"id": 1}], "totalRegistros": 2, "paginasRestantes": 1}
    page2 = {"data": [{"id": 2}], "totalRegistros": 2, "paginasRestantes": 0}
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return httpx.Response(200, json=page1 if calls["n"] == 1 else page2)

    with _client_with_handler(handler) as client:
        pages = list(
            client.iter_publication_pages(date_from="20260102", date_to="20260102", modality_id=6)
        )

    assert calls["n"] == 2
    assert [p["data"] for p in pages] == [[{"id": 1}], [{"id": 2}]]


def test_iter_update_pages_204_on_first_page_yields_one_empty_page():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(204)

    with _client_with_handler(handler) as client:
        pages = list(
            client.iter_update_pages(date_from="20260102", date_to="20260102", modality_id=6)
        )

    assert len(pages) == 1
    assert pages[0]["data"] == []


# ------------------------------------------------------------- detail endpoints


def test_fetch_items_pages_bare_array_until_204():
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.url.params["pagina"])
        assert request.url.path == "/api/pncp/v1/orgaos/00000000000191/compras/2026/2592/itens"
        if request.url.params["pagina"] == "1":
            return httpx.Response(200, json=[{"numeroItem": 1}, {"numeroItem": 2}])
        return httpx.Response(204)

    with _client_with_handler(handler) as client:
        items = client.fetch_items(agency_tax_id="00000000000191", year=2026, sequence=2592)

    assert seen == ["1", "2"]
    assert [i["numeroItem"] for i in items] == [1, 2]


def test_fetch_documents_404_on_first_page_means_nothing_published():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/pncp/v1/orgaos/00000000000191/compras/2026/2592/arquivos"
        return httpx.Response(404, text="not found")

    with _client_with_handler(handler) as client:
        assert (
            client.fetch_documents(agency_tax_id="00000000000191", year=2026, sequence=2592) == []
        )


def test_fetch_item_results_fetches_only_page_one():
    # PAGINATION TRAP: /resultados ignores `pagina` and echoes page 1 forever.
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        assert request.url.path == (
            "/api/pncp/v1/orgaos/00000000000191/compras/2026/2592/itens/1/resultados"
        )
        return httpx.Response(200, json=[{"sequencialResultado": 1}])

    with _client_with_handler(handler) as client:
        results = client.fetch_item_results(
            agency_tax_id="00000000000191", year=2026, sequence=2592, item_number=1
        )

    assert calls["n"] == 1
    assert results == [{"sequencialResultado": 1}]


# ------------------------------------------------------------------- PCA plans


def test_fetch_plans_update_page_uses_data_inicio_fim_params():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/consulta/v1/pca/atualizacao"
        assert request.url.params["dataInicio"] == "20260101"
        assert request.url.params["dataFim"] == "20260131"
        assert request.url.params["pagina"] == "2"
        assert request.url.params["tamanhoPagina"] == "50"
        return httpx.Response(
            200,
            json={
                "data": [{"idPcaPncp": "00000000000191-0-000001/2026", "itens": []}],
                "totalRegistros": 1,
                "totalPaginas": 2,
                "numeroPagina": 2,
                "paginasRestantes": 0,
                "empty": False,
            },
        )

    with _client_with_handler(handler) as client:
        page = client.fetch_plans_update_page(date_from="20260101", date_to="20260131", page=2)

    assert page["data"][0]["idPcaPncp"] == "00000000000191-0-000001/2026"


def test_fetch_plans_update_page_204_returns_empty_page():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(204)

    with _client_with_handler(handler) as client:
        page = client.fetch_plans_update_page(date_from="20260101", date_to="20260131", page=1)

    assert page["data"] == []
    assert page["paginasRestantes"] == 0
    assert page["empty"] is True


# -------------------------------------------------------------------- contracts


def test_fetch_contracts_page_hits_contratos_with_data_inicial_final():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/consulta/v1/contratos"
        assert request.url.params["dataInicial"] == "20260201"
        assert request.url.params["dataFinal"] == "20260228"
        assert request.url.params["pagina"] == "1"
        assert request.url.params["tamanhoPagina"] == "20"
        return httpx.Response(200, json=PAGE)

    with _client_with_handler(handler) as client:
        page = client.fetch_contracts_page(
            date_from="20260201", date_to="20260228", page=1, page_size=20
        )

    assert page["totalRegistros"] == 1


def test_fetch_contracts_page_updated_hits_atualizacao():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/consulta/v1/contratos/atualizacao"
        return httpx.Response(200, json=PAGE)

    with _client_with_handler(handler) as client:
        page = client.fetch_contracts_page(
            date_from="20260201", date_to="20260228", page=1, updated=True
        )

    assert page["numeroPagina"] == 1


def test_fetch_contracts_page_204_returns_empty_page():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(204)

    with _client_with_handler(handler) as client:
        page = client.fetch_contracts_page(date_from="20260201", date_to="20260228", page=3)

    assert page["data"] == []
    assert page["numeroPagina"] == 3


def test_fetch_contract_amendments_pages_bare_array():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/pncp/v1/orgaos/00000000000191/contratos/2026/17/termos"
        if request.url.params["pagina"] == "1":
            return httpx.Response(200, json=[{"sequencialTermoContrato": 1}])
        return httpx.Response(200, json=[])

    with _client_with_handler(handler) as client:
        amendments = client.fetch_contract_amendments(
            agency_tax_id="00000000000191", year=2026, sequence=17
        )

    assert amendments == [{"sequencialTermoContrato": 1}]


def test_fetch_contract_amendments_204_returns_empty():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(204)

    with _client_with_handler(handler) as client:
        assert (
            client.fetch_contract_amendments(agency_tax_id="00000000000191", year=2026, sequence=17)
            == []
        )
