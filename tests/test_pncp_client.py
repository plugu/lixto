"""Unit tests for src/plic/pncp_client.py.

No live network calls: httpx.MockTransport stands in for PNCP, and
time.sleep is monkeypatched to a no-op so retry/backoff/cooldown paths run
instantly.
"""

import json
from pathlib import Path

import httpx
import pytest

from plic import pncp_client
from plic.pncp_client import PncpApiError, PncpClient

FIXTURE_PATH = Path(__file__).parent / "fixtures" / "publicacao_page.json"


@pytest.fixture(autouse=True)
def _no_sleep(monkeypatch):
    """Every test in this module runs with retry/backoff sleeps stubbed out."""
    monkeypatch.setattr(pncp_client.time, "sleep", lambda _seconds: None)


def _load_fixture_page() -> dict:
    return json.loads(FIXTURE_PATH.read_text())


def _client_with_handler(handler) -> PncpClient:
    return PncpClient(transport=httpx.MockTransport(handler))


def test_get_publicacao_page_success_returns_decoded_json():
    fixture = _load_fixture_page()

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.params["codigoModalidadeContratacao"] == "6"
        assert request.url.params["dataInicial"] == "20260102"
        return httpx.Response(200, json=fixture)

    client = _client_with_handler(handler)
    page = client.get_publicacao_page(
        data_inicial="20260102",
        data_final="20260102",
        codigo_modalidade_contratacao=6,
        pagina=1,
    )
    client.close()

    assert page["totalRegistros"] == fixture["totalRegistros"]
    assert len(page["data"]) == len(fixture["data"])


def test_retries_on_429_then_succeeds():
    fixture = _load_fixture_page()
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] == 1:
            return httpx.Response(429, text="<html>rate limited</html>")
        return httpx.Response(200, json=fixture)

    client = _client_with_handler(handler)
    page = client.get_publicacao_page(
        data_inicial="20260102",
        data_final="20260102",
        codigo_modalidade_contratacao=6,
        pagina=1,
    )
    client.close()

    assert calls["n"] == 2
    assert page["totalRegistros"] == fixture["totalRegistros"]


def test_retries_on_503_then_succeeds():
    fixture = _load_fixture_page()
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] < 3:
            # 5xx bodies are HTML, never JSON — make sure we don't try to parse them.
            return httpx.Response(503, text="<html>bad gateway</html>")
        return httpx.Response(200, json=fixture)

    client = _client_with_handler(handler)
    page = client.get_publicacao_page(
        data_inicial="20260102",
        data_final="20260102",
        codigo_modalidade_contratacao=6,
        pagina=1,
    )
    client.close()

    assert calls["n"] == 3
    assert page["totalRegistros"] == fixture["totalRegistros"]


def test_does_not_retry_on_400():
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return httpx.Response(400, text="bad request")

    client = _client_with_handler(handler)
    with pytest.raises(PncpApiError):
        client.get_publicacao_page(
            data_inicial="20260102",
            data_final="20260102",
            codigo_modalidade_contratacao=6,
            pagina=1,
        )
    client.close()

    assert calls["n"] == 1


def test_raises_after_exhausting_retries():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, text="<html>server error</html>")

    client = _client_with_handler(handler)
    with pytest.raises(PncpApiError):
        client.get_publicacao_page(
            data_inicial="20260102",
            data_final="20260102",
            codigo_modalidade_contratacao=6,
            pagina=1,
        )
    client.close()


def test_iter_publicacao_pages_stops_when_no_pages_remaining():
    page1 = {"data": [{"id": 1}], "totalRegistros": 2, "paginasRestantes": 1}
    page2 = {"data": [{"id": 2}], "totalRegistros": 2, "paginasRestantes": 0}
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return httpx.Response(200, json=page1 if calls["n"] == 1 else page2)

    client = _client_with_handler(handler)
    pages = list(
        client.iter_publicacao_pages(
            data_inicial="20260102",
            data_final="20260102",
            codigo_modalidade_contratacao=6,
        )
    )
    client.close()

    assert len(pages) == 2
    assert calls["n"] == 2
    assert pages[0]["data"] == [{"id": 1}]
    assert pages[1]["data"] == [{"id": 2}]
