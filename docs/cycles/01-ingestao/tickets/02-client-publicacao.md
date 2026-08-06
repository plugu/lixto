---
id: 02
status: done
model: sonnet
depends_on: [01]
max_attempts: 3
files:
  - src/plic/pncp_client.py
  - src/plic/sync_publicacao.py
  - src/plic/cli.py
  - tests/test_pncp_client.py
  - tests/test_sync_publicacao.py
  - tests/fixtures/publicacao_page.json
---
## Goal
PNCP HTTP client + `plic sync publicacao` that upserts licitações for a date range into Postgres.

## Context
Endpoints, params, DTO fields, rate-limit and retry rules: `docs/PNCP_API.md` — follow it exactly (≥1 s between requests, retry 429/500–504 with backoff + ~30 s cooldown on 429, 90 s timeout, 5xx bodies are HTML). Client: httpx, sync (no asyncio needed at 1 req/s).

CLI: `plic sync publicacao --data-inicial YYYY-MM-DD --data-final YYYY-MM-DD [--modalidade N ...]` (default: all 13 modalidades). For each modalidade: page through `/v1/contratacoes/publicacao` (`tamanhoPagina=50`) until `paginasRestantes=0`; log `totalRegistros` per modalidade.

Upsert: `INSERT ... ON CONFLICT (numero_controle_pncp) DO UPDATE ... WHERE EXCLUDED.data_atualizacao_global > licitacao.data_atualizacao_global` (skip stale). On update that changes `data_atualizacao_global`, NULL both `*_sincronizados_em` stamps so details are re-fetched later. Full API object into `raw`.

Save one real API page as `tests/fixtures/publicacao_page.json` (fetch with curl during the ticket).

## Checks (run in order — cheapest first)
1. `uv run ruff check .`
2. `uv run pytest`
3. `docker compose up -d && uv run plic db init && uv run plic sync publicacao --data-inicial 2026-01-02 --data-final 2026-01-02 --modalidade 6 && docker compose exec -T db psql -U plic -d plic -tc 'select count(*) from licitacao' | awk '{exit ($1>0)?0:1}'`

## Done when
- Real one-day pregão-eletrônico sync inserts rows; rerunning it changes nothing (idempotent).
- Tests (fixture-based, no network): DTO→row mapping incl. nullable dates/nested orgao/unidade; upsert freshness rule.

## Not included
- No items/arquivos fetching, no backfill orchestration, no watermark logic, no retries beyond the documented policy.
