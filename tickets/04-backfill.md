---
id: 04
status: todo
model: sonnet
depends_on: [02, 03]
max_attempts: 3
files:
  - src/plic/backfill.py
  - src/plic/status.py
  - src/plic/cli.py
  - tests/test_backfill.py
---
## Goal
Resumable `plic backfill` covering every modalidade from 2026-01-01 to today, plus a `plic status` report.

## Context
Work unit: (modalidade 1–13) × 7-day date chunk from `--since` (default 2026-01-01) to today. For each unit call the ticket-02 publicação sync, then record `sync_state` key `backfill:{modalidade}:{chunk_start}` with `{status: done, total_registros, finished_at}`. On start, skip units already `done` — a crashed run resumes where it stopped. After all chunks: loop `sync detalhes` in batches (e.g. 500) until no unstamped licitações remain. Log `totalRegistros` per unit (reconciliation vs PNCP portal). Expect hours of wall-clock at 1 req/s — print progress (unit x/y, rows so far).

`plic status`: counts total/per-modalidade, rows in `v_abertas`/`v_futuras`/`v_encerradas`, licitações pending detalhes, item/documento counts, newest `data_atualizacao_global`.

## Checks (run in order — cheapest first)
1. `uv run ruff check .`
2. `uv run pytest`
3. `docker compose up -d && uv run plic backfill --since 2026-01-02 --until 2026-01-03 --modalidade 3 && uv run plic status`

## Done when
- Small real backfill (one modalidade, two days via `--until`/`--modalidade` test flags) completes, writes `sync_state` rows, and rerunning it skips all done units instantly.
- Unit tests: chunk generation (boundaries, partial last chunk), resume-skip logic — no network.

## Not included
- No atualização/watermark sync, no scheduler, no parallel requests, no progress UI beyond log lines.
