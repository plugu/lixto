---
id: 125
status: done
model: sonnet
depends_on: [124]
max_attempts: 3
files:
  - src/lixto/enrich/plan_embed.py
  - src/lixto/cli/plans.py
  - src/lixto/cli/radar.py
  - src/lixto/internal_api.py
  - tests/test_enrich_plan_embed.py
  - tests/test_cli_radar.py
---
## Goal
`lixto plans embed` fills `plan_item_embeddings` for in-horizon PCA items, and `lixto radar run` triggers the web app's `POST /api/internal/radar/run`.

## Context
Cycle 24 Radar (PRODUCT.md). Ticket 124 created `plan_item_embeddings (plan_id, item_number, model, embedding vector(1536), embedded_at, PK (plan_id, item_number), FK (plan_id, item_number) → procurement_plan_items ON DELETE CASCADE)` in `migrations/005_radar.sql` and the internal route.

**`src/lixto/enrich/plan_embed.py`** — mirror `src/lixto/enrich/embed.py` exactly (batching by `BATCH_SIZE`, commit per batch, lazy `LlmClient()`, `RunCounters`, stop-on-SDK-error, reuse `to_pgvector` from `lixto.enrich.embed`). Differences:
- Pending select: items from `procurement_plan_items i JOIN procurement_plans p` where `p.year >= extract(year from current_date)` AND (`i.desired_date IS NULL` OR `i.desired_date >= current_date`) AND `i.desired_date` is NULL or `<= current_date + %(horizon_days)s` AND no row in `plan_item_embeddings` for `(plan_id, item_number)` AND `coalesce(i.description,'') <> ''`; `ORDER BY i.desired_date ASC NULLS LAST, p.id, i.item_number LIMIT %(limit)s`.
- `build_plan_item_text(row)`: `description` + newline + `pdm_description` (if present and not already contained in description, case-insensitive) + newline + `category_name`/`catalog_classification_name` (skip empties). Deterministic.
- Upsert into `plan_item_embeddings` on conflict `(plan_id, item_number)`.
- Horizon days from env `LIXTO_RADAR_HORIZON_DAYS` (default `365`); read in the CLI, passed in as a parameter (the module stays env-free like `embed.py`).

**`src/lixto/cli/plans.py`** — add `@app.command("embed")` with `--limit` (per-run cap; when omitted, read env `LIXTO_RADAR_EMBED_LIMIT`, 0/unset = unlimited — a plain per-run cap, NOT the cross-run daily-cap machinery of `enrich run`); print counters like `enrich embed` does (`src/lixto/cli/enrich.py:70`).

**`src/lixto/cli/radar.py`** — new command group `name = "radar"`, `@app.command("run")` with `--company-id`; copy `src/lixto/cli/match.py` shape verbatim, calling `InternalApi.radar_run(company_id=...)` and printing `runId`, `companies`, `opportunities`, `matched`. Add `radar_run()` to `src/lixto/internal_api.py` posting `/api/internal/radar/run` (extend the module docstring list).

Tests: mirror `tests/test_enrich_embed.py` (mocked psycopg + LlmClient) and the stub pattern in `tests/test_cli_match_recommend.py`. `tests/test_cli_discovery.py` must still pass (`lixto --help` lists `radar`).

## Checks (run in order — cheapest first)
1. `ruff check src tests && ruff format --check src tests`
2. `pytest -q tests/test_enrich_plan_embed.py tests/test_cli_radar.py tests/test_cli_discovery.py`
3. `pytest -q`
4. `lixto plans embed --help | grep -- --limit && lixto radar run --help | grep -- --company-id`

## Done when
- `lixto plans embed --limit 5` against the dev DB (docker-compose, after `lixto plans sync --since <recent>`) writes ≤5 rows into `plan_item_embeddings` and prints `processed/embedded/error`.
- `lixto radar run` with the web app running prints the four counters; without `LIXTO_INTERNAL_TOKEN` it exits 1 with a clear message (existing settings behavior).

## Not included
- Any scoring logic (web app, ticket 124).
- Changes to `sync_plans` or the `plans-sync` schedule (ops/docs, ticket 129).
- Dedup of identical descriptions across items (V2 optimisation if storage bites).
