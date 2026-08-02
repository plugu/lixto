"""Thin sync HTTP client for the PNCP consulta API.

Policy (docs/PNCP_API.md, "Measured behavior"):
- self-impose an interval between requests, default 0.5 s = 2 req/s
  (PNCP starts 429ing above ~6 req/s; override via PLIC_MIN_REQUEST_INTERVAL)
- retry 429 and 500-504 with exponential backoff, max ~5 attempts
- on 429, cool down ~30 s (honor Retry-After header when present)
- 90 s request timeout (large pages have been observed to take >60 s)
- 5xx bodies are HTML, not JSON — never try to parse them as JSON
- do not retry other 4xx (they mean a bad request, not a flap)

mvp mode: one small client, no abstraction for other PNCP APIs (items,
arquivos, atualizacao) beyond what ticket 02 needs — those come later.
"""

from __future__ import annotations

import logging
import os
import time
from typing import Any, Self

import httpx

logger = logging.getLogger(__name__)

BASE_URL_CONSULTA = "https://pncp.gov.br/api/consulta"

# PNCP starts 429ing around ~6 req/s (measured); 2 req/s keeps a 3x margin,
# and the 429 cooldown below absorbs the occasional excess.
MIN_REQUEST_INTERVAL_SECONDS = float(os.environ.get("PLIC_MIN_REQUEST_INTERVAL", "0.5"))
REQUEST_TIMEOUT_SECONDS = 90.0
MAX_RETRIES = 5
RETRYABLE_STATUS_CODES = {429, 500, 501, 502, 503, 504}
RATE_LIMIT_COOLDOWN_SECONDS = 30.0
BACKOFF_BASE_SECONDS = 2.0


class PncpApiError(RuntimeError):
    """Raised when a PNCP request fails after exhausting retries."""


class PncpClient:
    """Sync HTTP client for the PNCP consulta API, with rate limiting and retries."""

    def __init__(
        self,
        base_url: str = BASE_URL_CONSULTA,
        min_request_interval: float = MIN_REQUEST_INTERVAL_SECONDS,
        timeout: float = REQUEST_TIMEOUT_SECONDS,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        # `transport` lets tests substitute httpx.MockTransport to exercise
        # retry/pagination logic with zero real network calls.
        self._client = httpx.Client(base_url=base_url, timeout=timeout, transport=transport)
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
                time.sleep(BACKOFF_BASE_SECONDS ** attempt)
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
                cooldown = (
                    float(retry_after) if retry_after else RATE_LIMIT_COOLDOWN_SECONDS
                )
                logger.warning(
                    "PNCP rate-limited (429) on %s %s, cooling down %.0fs",
                    path,
                    params,
                    cooldown,
                )
                time.sleep(cooldown)
            else:
                backoff = BACKOFF_BASE_SECONDS ** attempt
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

    def _get_search_page(
        self,
        path: str,
        *,
        data_inicial: str,
        data_final: str,
        codigo_modalidade_contratacao: int,
        pagina: int,
        tamanho_pagina: int = 50,
    ) -> dict[str, Any]:
        """Fetch one page of a `PaginaRetornoRecuperarCompra...DTO` endpoint.

        Shared by `/v1/contratacoes/publicacao` and `/v1/contratacoes/atualizacao`
        (docs/PNCP_API.md: identical params/response shape, `/atualizacao` just
        filters on `dataAtualizacaoGlobal` instead of publication date).
        `data_inicial`/`data_final` in `yyyyMMdd` format.

        Verified live (2026-08-01): a zero-result query returns HTTP 204 with
        an empty body rather than `200` + an empty envelope. Treated here as
        an empty page so callers (and `iter_*_pages`) never see a raw 204 —
        `/atualizacao` hits this constantly on quiet modalidades.
        """
        params = {
            "dataInicial": data_inicial,
            "dataFinal": data_final,
            "codigoModalidadeContratacao": codigo_modalidade_contratacao,
            "pagina": pagina,
            "tamanhoPagina": tamanho_pagina,
        }
        response = self._get(path, params)
        if response.status_code == 204:
            return {
                "data": [],
                "totalRegistros": 0,
                "totalPaginas": 0,
                "numeroPagina": pagina,
                "paginasRestantes": 0,
                "empty": True,
            }
        if response.status_code != 200:
            raise PncpApiError(f"PNCP returned {response.status_code} for {path} params={params}")
        return response.json()

    def get_publicacao_page(
        self,
        *,
        data_inicial: str,
        data_final: str,
        codigo_modalidade_contratacao: int,
        pagina: int,
        tamanho_pagina: int = 50,
    ) -> dict[str, Any]:
        """Fetch one page of `/v1/contratacoes/publicacao`.

        Returns the decoded `PaginaRetornoRecuperarCompraPublicacaoDTO` body
        (or an empty-page dict on HTTP 204 — see `_get_search_page`).
        """
        return self._get_search_page(
            "/v1/contratacoes/publicacao",
            data_inicial=data_inicial,
            data_final=data_final,
            codigo_modalidade_contratacao=codigo_modalidade_contratacao,
            pagina=pagina,
            tamanho_pagina=tamanho_pagina,
        )

    def get_atualizacao_page(
        self,
        *,
        data_inicial: str,
        data_final: str,
        codigo_modalidade_contratacao: int,
        pagina: int,
        tamanho_pagina: int = 50,
    ) -> dict[str, Any]:
        """Fetch one page of `/v1/contratacoes/atualizacao` (incremental sync
        by `dataAtualizacaoGlobal` — same params/DTO shape as `/publicacao`).
        """
        return self._get_search_page(
            "/v1/contratacoes/atualizacao",
            data_inicial=data_inicial,
            data_final=data_final,
            codigo_modalidade_contratacao=codigo_modalidade_contratacao,
            pagina=pagina,
            tamanho_pagina=tamanho_pagina,
        )

    def _iter_search_pages(
        self,
        get_page,
        *,
        data_inicial: str,
        data_final: str,
        codigo_modalidade_contratacao: int,
        tamanho_pagina: int = 50,
    ):
        """Yield each page dict for a modalidade until `paginasRestantes` is 0."""
        pagina = 1
        while True:
            page = get_page(
                data_inicial=data_inicial,
                data_final=data_final,
                codigo_modalidade_contratacao=codigo_modalidade_contratacao,
                pagina=pagina,
                tamanho_pagina=tamanho_pagina,
            )
            yield page

            if page.get("paginasRestantes", 0) <= 0:
                break
            pagina += 1

    def iter_publicacao_pages(
        self,
        *,
        data_inicial: str,
        data_final: str,
        codigo_modalidade_contratacao: int,
        tamanho_pagina: int = 50,
    ):
        """Yield each `/publicacao` page dict for a modalidade until drained."""
        yield from self._iter_search_pages(
            self.get_publicacao_page,
            data_inicial=data_inicial,
            data_final=data_final,
            codigo_modalidade_contratacao=codigo_modalidade_contratacao,
            tamanho_pagina=tamanho_pagina,
        )

    def iter_atualizacao_pages(
        self,
        *,
        data_inicial: str,
        data_final: str,
        codigo_modalidade_contratacao: int,
        tamanho_pagina: int = 50,
    ):
        """Yield each `/atualizacao` page dict for a modalidade until drained."""
        yield from self._iter_search_pages(
            self.get_atualizacao_page,
            data_inicial=data_inicial,
            data_final=data_final,
            codigo_modalidade_contratacao=codigo_modalidade_contratacao,
            tamanho_pagina=tamanho_pagina,
        )
