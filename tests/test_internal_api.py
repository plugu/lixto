"""Unit tests for src/lixto/internal_api.py.

No live network calls: httpx.MockTransport stands in for the web app's
`/api/internal/*` endpoints (tickets 90/91), same style as
tests/test_pncp_client.py.
"""

import json

import httpx
import pytest

from lixto.internal_api import InternalApi, InternalApiError


def _client_with_handler(handler) -> InternalApi:
    return InternalApi(
        "http://web.internal", "secret-token", transport=httpx.MockTransport(handler)
    )


def test_match_run_posts_path_headers_and_body():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"
        assert request.url.path == "/api/internal/match/run"
        assert request.headers["x-lixto-internal-token"] == "secret-token"
        assert json.loads(request.read()) == {"companyId": 7, "since": "2026-08-01"}
        return httpx.Response(
            200, json={"runId": 1, "companies": 3, "scored": 10, "matched": 4, "attention": 1}
        )

    with _client_with_handler(handler) as client:
        result = client.match_run(company_id=7, since="2026-08-01")

    assert result == {"runId": 1, "companies": 3, "scored": 10, "matched": 4, "attention": 1}


def test_match_run_omits_unset_fields_from_body():
    def handler(request: httpx.Request) -> httpx.Response:
        assert json.loads(request.read()) == {}
        return httpx.Response(
            200, json={"runId": 2, "companies": 0, "scored": 0, "matched": 0, "attention": 0}
        )

    with _client_with_handler(handler) as client:
        client.match_run()


def test_recommend_run_posts_path_and_body():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/internal/recommend/run"
        assert json.loads(request.read()) == {"companyId": 7, "limit": 5}
        return httpx.Response(
            200,
            json={"runId": 3, "companies": 2, "recommended": 5, "skipped_cap": 1, "failed": 0},
        )

    with _client_with_handler(handler) as client:
        result = client.recommend_run(company_id=7, limit=5)

    assert result["recommended"] == 5


def test_cases_run_posts_path_and_body():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/internal/cases/run"
        assert json.loads(request.read()) == {"companyId": 7}
        return httpx.Response(
            200,
            json={
                "runId": 12,
                "created": 3,
                "ready": 2,
                "waiting": 1,
                "emailed": 0,
                "resultsRequested": 0,
                "resolved": 0,
                "failed": 0,
            },
        )

    with _client_with_handler(handler) as client:
        result = client.cases_run(company_id=7)

    assert result["created"] == 3


def test_raises_internal_api_error_on_401():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, text="unauthorized")

    with _client_with_handler(handler) as client, pytest.raises(InternalApiError) as exc_info:
        client.match_run()

    assert exc_info.value.status_code == 401
    assert "unauthorized" in exc_info.value.body


def test_raises_internal_api_error_on_500_with_json_body():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, json={"error": "boom"})

    with _client_with_handler(handler) as client, pytest.raises(InternalApiError) as exc_info:
        client.recommend_run()

    assert exc_info.value.status_code == 500
    assert "boom" in exc_info.value.body
    assert "500" in str(exc_info.value)
