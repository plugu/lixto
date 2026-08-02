---
id: 05
status: done
model: sonnet
depends_on: [04]
max_attempts: 3
files:
  - src/plic/sync_incremental.py
  - src/plic/pncp_client.py
  - src/plic/backfill.py
  - src/plic/cli.py
  - tests/test_sync_incremental.py
---
## Goal
`plic sync incremental` — the twice-daily run: pull everything changed since the last run and refresh details.

## Context
Endpoint `/v1/contratacoes/atualizacao` (params/DTO identical to publicação — `docs/PNCP_API.md`); it filters on `dataAtualizacaoGlobal`, catching new licitações AND edits/addenda/status changes. Per modalidade: watermark in `sync_state` key `incremental:{modalidade}` = max `dataAtualizacaoGlobal` seen. Query window: watermark date (or `--since`, or newest `data_atualizacao_global` in DB as bootstrap) → today, `yyyyMMdd` granularity, so re-fetch overlap is expected — the ticket-02 upsert freshness rule makes it harmless. Advance watermark only after the modalidade completes. Reuse ticket-02 upsert (it already NULLs `*_sincronizados_em` on real updates). Then run detalhes loop until drained. Exit non-zero if any modalidade failed after retries (so the scheduler surfaces it), still finishing the others first.

Ticket-04 discovery: zero-result consulta queries return HTTP 204 (see `docs/PNCP_API.md`); `backfill.py` currently works around this with a string-match catch on `PncpApiError` "returned 204". Fix centrally: make the client/`sync_publicacao` treat 204 as an empty page, then delete backfill's string-match workaround. `/atualizacao` will hit 204 constantly on quiet modalidades.

## Checks (run in order — cheapest first)
1. `uv run ruff check .`
2. `uv run pytest`
3. `docker compose up -d && uv run plic sync incremental --since 2026-08-01 && uv run plic status`
   <!-- probe bounded with --since: on a non-backfilled dev DB the bootstrap watermark is months old and an unbounded run re-downloads most of 2026 at 1 req/s -->

## Done when
- Real run completes across all modalidades, advances 13 watermarks, and a second immediate run does near-zero work.
- Unit tests: watermark bootstrap/advance, failure of one modalidade doesn't block others — no network.

## Not included
- No scheduler installation, no notifications, no re-backfill logic.
