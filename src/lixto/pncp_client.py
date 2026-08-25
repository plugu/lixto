"""Thin sync HTTP client for the PNCP APIs (consulta + pncp).

Policy (docs/PNCP_API.md, "Measured behavior"):
- self-impose an interval between requests, default 0.25 s = 4 req/s
  (PNCP starts 429ing above ~6 req/s; override via LIXTO_MIN_REQUEST_INTERVAL)
- retry 429 and 500-504 with exponential backoff, max ~5 attempts
- on 429, cool down ~30 s (honor Retry-After header when present)
- 90 s request timeout (large pages have been observed to take >60 s)
- 5xx bodies are HTML, not JSON — never try to parse them as JSON
- do not retry other 4xx (they mean a bad request, not a flap)

Two PNCP APIs are covered by one client: the search/consulta API
(`https://pncp.gov.br/api/consulta`, paged envelopes) is the client's
`base_url`; the detail API (`https://pncp.gov.br/api/pncp`, bare arrays) is
reached with absolute URLs built from `pncp_base_url`, so both share the same
throttle and retry budget.

Endpoint families:
- envelope pages: `fetch_publication_page`, `fetch_update_page`,
  `fetch_plans_update_page`, `fetch_contracts_page` (+ `iter_*_pages`)
- bare arrays: `fetch_items`, `fetch_documents`, `fetch_item_results`,
  `fetch_contract_amendments`

All date parameters are `yyyyMMdd` strings.
"""

from __future__ import annotations

import logging
import os
import time
from collections.abc import Iterator
from typing import Any, Self

import httpx

logger = logging.getLogger(__name__)

BASE_URL_CONSULTA = "https://pncp.gov.br/api/consulta"
BASE_URL_PNCP = "https://pncp.gov.br/api/pncp"

# PNCP starts 429ing around ~6 req/s (measured); 4 req/s default trades some
# 429 churn (absorbed by the cooldown below) for backfill wall-clock.
MIN_REQUEST_INTERVAL_SECONDS = float(os.environ.get("LIXTO_MIN_REQUEST_INTERVAL", "0.25"))
REQUEST_TIMEOUT_SECONDS = 90.0
MAX_RETRIES = 5
RETRYABLE_STATUS_CODES = {429, 500, 501, 502, 503, 504}
RATE_LIMIT_COOLDOWN_SECONDS = 30.0
BACKOFF_BASE_SECONDS = 2.0


class PncpApiError(RuntimeError):
    """Raised when a PNCP request fails after exhausting retries."""


class PncpClient:
    """Sync HTTP client for the PNCP APIs, with rate limiting and retries."""

    def __init__(
        self,
        base_url: str = BASE_URL_CONSULTA,
        pncp_base_url: str = BASE_URL_PNCP,
        min_request_interval: float = MIN_REQUEST_INTERVAL_SECONDS,
        timeout: float = REQUEST_TIMEOUT_SECONDS,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        # `transport` lets tests substitute httpx.MockTransport to exercise
        # retry/pagination logic with zero real network calls.
        self._client = httpx.Client(base_url=base_url, timeout=timeout, transport=transport)
        self._pncp_base_url = pncp_base_url.rstrip("/")
        self._min_request_interval = min_request_interval
        self._last_request_at: float | None = None

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> Self:
        return self

    def __exit__(self, *exc_info: object) -> None:
        self.close()

    def _throttle(self) -> None:
        if self._last_request_at is None:
            return
        elapsed = time.monotonic() - self._last_request_at
        remaining = self._min_request_interval - elapsed
        if remaining > 0:
            time.sleep(remaining)

    def _get(self, path: str, params: dict[str, Any]) -> httpx.Response:
        """GET with self-imposed rate limiting and retry on 429/5xx."""
        last_exc: Exception | None = None
        for attempt in range(1, MAX_RETRIES + 1):
            self._throttle()
            try:
                response = self._client.get(path, params=params)
            except httpx.TransportError as exc:
                last_exc = exc
                self._last_request_at = time.monotonic()
                logger.warning(
                    "PNCP request error (attempt %d/%d) %s %s: %s",
                    attempt,
                    MAX_RETRIES,
                    path,
                    params,
                    exc,
                )
                time.sleep(BACKOFF_BASE_SECONDS**attempt)
                continue

            self._last_request_at = time.monotonic()

            if response.status_code not in RETRYABLE_STATUS_CODES:
                return response

            last_exc = PncpApiError(
                f"PNCP returned {response.status_code} for {path} params={params}"
            )
            if attempt == MAX_RETRIES:
                break

            if response.status_code == 429:
                retry_after = response.headers.get("Retry-After")
                cooldown = float(retry_after) if retry_after else RATE_LIMIT_COOLDOWN_SECONDS
                logger.warning(
                    "PNCP rate-limited (429) on %s %s, cooling down %.0fs",
                    path,
                    params,
                    cooldown,
                )
                time.sleep(cooldown)
            else:
                backoff = BACKOFF_BASE_SECONDS**attempt
                logger.warning(
                    "PNCP returned %d (attempt %d/%d) on %s %s, backing off %.0fs",
                    response.status_code,
                    attempt,
                    MAX_RETRIES,
                    path,
                    params,
                    backoff,
                )
                time.sleep(backoff)

        raise PncpApiError(
            f"PNCP request failed after {MAX_RETRIES} attempts: {path} params={params}"
        ) from last_exc

    # ------------------------------------------------------------------ pages

    @staticmethod
    def _empty_page(page: int) -> dict[str, Any]:
        """The envelope a zero-result query would have returned on HTTP 204."""
        return {
            "data": [],
            "totalRegistros": 0,
            "totalPaginas": 0,
            "numeroPagina": page,
            "paginasRestantes": 0,
            "empty": True,
        }

    def _get_page(self, path: str, params: dict[str, Any], *, page: int) -> dict[str, Any]:
        """Fetch one page of a `PaginaRetorno...DTO` endpoint.

        Verified live (2026-08-01): a zero-result query returns HTTP 204 with
        an empty body rather than `200` + an empty envelope. Treated here as
        an empty page so callers (and `iter_*_pages`) never see a raw 204 —
        `/atualizacao` hits this constantly on quiet modalidades.
        """
        response = self._get(path, params)
        if response.status_code == 204:
            return self._empty_page(page)
        if response.status_code != 200:
            raise PncpApiError(f"PNCP returned {response.status_code} for {path} params={params}")
        return response.json()

    def _fetch_search_page(
        self,
        path: str,
        *,
        date_from: str,
        date_to: str,
        modality_id: int,
        page: int,
        page_size: int = 50,
    ) -> dict[str, Any]:
        """One page of `/v1/contratacoes/publicacao` or `/atualizacao`.

        Identical params/response shape (docs/PNCP_API.md); `/atualizacao`
        just filters on `dataAtualizacaoGlobal` instead of publication date.
        """
        params = {
            "dataInicial": date_from,
            "dataFinal": date_to,
            "codigoModalidadeContratacao": modality_id,
            "pagina": page,
            "tamanhoPagina": page_size,
        }
        return self._get_page(path, params, page=page)

    def fetch_publication_page(
        self,
        *,
        date_from: str,
        date_to: str,
        modality_id: int,
        page: int,
        page_size: int = 50,
    ) -> dict[str, Any]:
        """One page of `/v1/contratacoes/publicacao` (backfill by publication date).

        Returns the decoded `PaginaRetornoRecuperarCompraPublicacaoDTO` body
        (or an empty-page dict on HTTP 204 — see `_get_page`).
        """
        return self._fetch_search_page(
            "/v1/contratacoes/publicacao",
            date_from=date_from,
            date_to=date_to,
            modality_id=modality_id,
            page=page,
            page_size=page_size,
        )

    def fetch_update_page(
        self,
        *,
        date_from: str,
        date_to: str,
        modality_id: int,
        page: int,
        page_size: int = 50,
    ) -> dict[str, Any]:
        """One page of `/v1/contratacoes/atualizacao` (incremental sync by
        `dataAtualizacaoGlobal` — same params/DTO shape as `/publicacao`).
        """
        return self._fetch_search_page(
            "/v1/contratacoes/atualizacao",
            date_from=date_from,
            date_to=date_to,
            modality_id=modality_id,
            page=page,
            page_size=page_size,
        )

    def fetch_plans_update_page(
        self,
        *,
        date_from: str,
        date_to: str,
        page: int,
        page_size: int = 50,
    ) -> dict[str, Any]:
        """One page of `/v1/pca/atualizacao` — annual procurement plans (PCA)
        updated in the window, each with its items embedded.

        Envelope: `PaginaRetornoPlanoContratacaoComItensDoUsuarioDTO` (same
        shape as the contratações envelopes). Note the param names differ from
        the contratações endpoints: `dataInicio`/`dataFim`, not
        `dataInicial`/`dataFinal`.
        """
        params = {
            "dataInicio": date_from,
            "dataFim": date_to,
            "pagina": page,
            "tamanhoPagina": page_size,
        }
        return self._get_page("/v1/pca/atualizacao", params, page=page)

    def fetch_contracts_page(
        self,
        *,
        date_from: str,
        date_to: str,
        page: int,
        page_size: int = 50,
        updated: bool = False,
    ) -> dict[str, Any]:
        """One page of `/v1/contratos` (by publication date) or, with
        `updated=True`, `/v1/contratos/atualizacao` (by `dataAtualizacaoGlobal`).

        Both take `dataInicial`/`dataFinal` (`yyyyMMdd`) and return a page
        envelope of `RecuperarContratoDTO`.
        """
        path = "/v1/contratos/atualizacao" if updated else "/v1/contratos"
        params = {
            "dataInicial": date_from,
            "dataFinal": date_to,
            "pagina": page,
            "tamanhoPagina": page_size,
        }
        return self._get_page(path, params, page=page)

    def _iter_search_pages(
        self,
        fetch_page,
        *,
        date_from: str,
        date_to: str,
        modality_id: int,
        page_size: int = 50,
    ) -> Iterator[dict[str, Any]]:
        """Yield each page dict for a modality until `paginasRestantes` is 0."""
        page = 1
        while True:
            body = fetch_page(
                date_from=date_from,
                date_to=date_to,
                modality_id=modality_id,
                page=page,
                page_size=page_size,
            )
            yield body

            if body.get("paginasRestantes", 0) <= 0:
                break
            page += 1

    def iter_publication_pages(
        self,
        *,
        date_from: str,
        date_to: str,
        modality_id: int,
        page_size: int = 50,
    ) -> Iterator[dict[str, Any]]:
        """Yield each `/publicacao` page dict for a modality until drained."""
        yield from self._iter_search_pages(
            self.fetch_publication_page,
            date_from=date_from,
            date_to=date_to,
            modality_id=modality_id,
            page_size=page_size,
        )

    def iter_update_pages(
        self,
        *,
        date_from: str,
        date_to: str,
        modality_id: int,
        page_size: int = 50,
    ) -> Iterator[dict[str, Any]]:
        """Yield each `/atualizacao` page dict for a modality until drained."""
        yield from self._iter_search_pages(
            self.fetch_update_page,
            date_from=date_from,
            date_to=date_to,
            modality_id=modality_id,
            page_size=page_size,
        )

    # ------------------------------------------------------------ bare arrays

    def _fetch_bare_array(
        self,
        path: str,
        *,
        page_size: int = 50,
        first_page_only: bool = False,
    ) -> list[dict[str, Any]]:
        """Page a bare-array endpoint (no envelope) until an empty page.

        A 404 on the first page is treated as "nothing published" (empty
        list) — the endpoint has no page envelope to signal that otherwise. A
        404 on any later page (shouldn't happen, but data is data) is an
        error, not silently swallowed.

        Verified live (2026-08-01): PNCP signals "no more pages" on a page
        past the first with an HTTP 204 (empty body), not a `200` with a bare
        `[]` — handle both as end-of-pagination.
        """
        results: list[dict[str, Any]] = []
        page = 1
        while True:
            params = {"pagina": page, "tamanhoPagina": page_size}
            response = self._get(path, params)

            if response.status_code == 404:
                if page == 1:
                    return []
                raise PncpApiError(f"unexpected 404 on page {page} for {path}")

            if response.status_code == 204:
                break

            if response.status_code != 200:
                raise PncpApiError(f"PNCP returned {response.status_code} for {path}")

            body = response.json()
            if not body:
                break
            results.extend(body)
            if first_page_only:
                break
            page += 1

        return results

    def _procurement_path(self, agency_tax_id: str, year: int, sequence: int) -> str:
        return f"{self._pncp_base_url}/v1/orgaos/{agency_tax_id}/compras/{year}/{sequence}"

    def fetch_items(
        self, *, agency_tax_id: str, year: int, sequence: int, page_size: int = 50
    ) -> list[dict[str, Any]]:
        """All `RecuperarCompraItemSigiloDTO` of one procurement (`/itens`)."""
        path = f"{self._procurement_path(agency_tax_id, year, sequence)}/itens"
        return self._fetch_bare_array(path, page_size=page_size)

    def fetch_documents(
        self, *, agency_tax_id: str, year: int, sequence: int, page_size: int = 50
    ) -> list[dict[str, Any]]:
        """All `RecuperarDadosDocumentoCompraDTO` of one procurement (`/arquivos`)."""
        path = f"{self._procurement_path(agency_tax_id, year, sequence)}/arquivos"
        return self._fetch_bare_array(path, page_size=page_size)

    def fetch_item_results(
        self,
        *,
        agency_tax_id: str,
        year: int,
        sequence: int,
        item_number: int,
        page_size: int = 50,
        first_page_only: bool = True,
    ) -> list[dict[str, Any]]:
        """All `RecuperarCompraItemResultadoDTO` of one item (`/resultados`).

        PAGINATION TRAP (docs/PNCP_API.md, verified live 2026-08-24): unlike
        `/itens` and `/arquivos`, this endpoint ignores `pagina` — pages 2, 3,
        … echo page 1 back with HTTP 200 forever, so a naive paginator never
        terminates. Page 1 is provably everything there is, hence
        `first_page_only=True` by default.
        """
        path = (
            f"{self._procurement_path(agency_tax_id, year, sequence)}"
            f"/itens/{item_number}/resultados"
        )
        return self._fetch_bare_array(path, page_size=page_size, first_page_only=first_page_only)

    def fetch_contract_amendments(
        self, *, agency_tax_id: str, year: int, sequence: int, page_size: int = 50
    ) -> list[dict[str, Any]]:
        """All `RecuperarTermoContratoDTO` of one contract (`/termos`).

        `/v1/orgaos/{cnpj}/contratos/{ano}/{sequencial}/termos` — a bare
        array paged like `/itens`; 204 (or `200 []`) ends pagination, a 404 on
        page 1 means the contract has no amendments.
        """
        path = f"{self._pncp_base_url}/v1/orgaos/{agency_tax_id}/contratos/{year}/{sequence}/termos"
        return self._fetch_bare_array(path, page_size=page_size)
