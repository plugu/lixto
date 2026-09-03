"""Thin sync HTTP client for the web app's internal batch endpoints.

The scoring/recommendation/email logic lives once, in the web app (tickets
90/91/113): `POST /api/internal/match/run`, `POST /api/internal/recommend/run`,
`POST /api/internal/email/send`, `POST /api/internal/email/digest` and
`POST /api/internal/email/bounces`, authenticated with a shared secret header
`x-lixto-internal-token`. The CLI (`lixto match run`, `lixto recommend run`,
`lixto email worker`, `lixto email digest`, `lixto email bounces`) is a thin
trigger so operators and Dokploy schedules keep a single CLI surface — no
scoring/rendering/SMTP in Python.

Contract:
- request: JSON body, all fields optional
  - match: `{"companyId"?: int, "since"?: ISO string}`
  - recommend: `{"companyId"?: int, "limit"?: int}`
  - email worker: `{"limit"?: int}`
  - email digest: `{"companyId"?: int}`
  - email bounces: `{}`
- response: `200` with the parsed JSON counters, or a non-2xx (401 on a bad
  token, 500 `{"error": ...}` on failure) — surfaced as `InternalApiError`.
"""

from __future__ import annotations

from typing import Any, Self

import httpx

DEFAULT_TIMEOUT_SECONDS = 600.0


class InternalApiError(RuntimeError):
    """Raised when an internal batch endpoint responds with a non-2xx status."""

    def __init__(self, status_code: int, body: str) -> None:
        self.status_code = status_code
        self.body = body
        super().__init__(f"internal API returned {status_code}: {body}")


class InternalApi:
    """Sync HTTP client for the web app's `/api/internal/*` batch endpoints."""

    def __init__(
        self,
        base_url: str,
        token: str,
        timeout: float = DEFAULT_TIMEOUT_SECONDS,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        # `transport` lets tests substitute httpx.MockTransport (see
        # tests/test_internal_api.py) with zero real network calls.
        self._client = httpx.Client(
            base_url=base_url,
            timeout=timeout,
            transport=transport,
            headers={"x-lixto-internal-token": token},
        )

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> Self:
        return self

    def __exit__(self, *exc_info: object) -> None:
        self.close()

    def _post(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        response = self._client.post(path, json=body)
        if not (200 <= response.status_code < 300):
            raise InternalApiError(response.status_code, response.text)
        return response.json()

    def match_run(
        self, *, company_id: int | None = None, since: str | None = None
    ) -> dict[str, Any]:
        """`POST /api/internal/match/run` → `{runId, companies, scored, matched, attention}`."""
        body: dict[str, Any] = {}
        if company_id is not None:
            body["companyId"] = company_id
        if since is not None:
            body["since"] = since
        return self._post("/api/internal/match/run", body)

    def recommend_run(
        self, *, company_id: int | None = None, limit: int | None = None
    ) -> dict[str, Any]:
        """`POST /api/internal/recommend/run` →
        `{runId, companies, recommended, skipped_cap, failed}`.
        """
        body: dict[str, Any] = {}
        if company_id is not None:
            body["companyId"] = company_id
        if limit is not None:
            body["limit"] = limit
        return self._post("/api/internal/recommend/run", body)

    def email_send(self, *, limit: int | None = None) -> dict[str, Any]:
        """`POST /api/internal/email/send` → one outbox worker pass:
        `{claimed, sent, failed, suppressed}`.
        """
        body: dict[str, Any] = {}
        if limit is not None:
            body["limit"] = limit
        return self._post("/api/internal/email/send", body)

    def email_digest(self, *, company_id: int | None = None) -> dict[str, Any]:
        """`POST /api/internal/email/digest` → enqueues today's daily digest:
        `{companies, enqueued, skipped}`.
        """
        body: dict[str, Any] = {}
        if company_id is not None:
            body["companyId"] = company_id
        return self._post("/api/internal/email/digest", body)

    def email_bounces(self) -> dict[str, Any]:
        """`POST /api/internal/email/bounces` → one pass over the MTA's DSN
        maildir: `{files, hard, soft, unparsed}`.

        No body: the maildir is `LIXTO_BOUNCE_MAILDIR` on the web container,
        never a caller-supplied path.
        """
        return self._post("/api/internal/email/bounces", {})
