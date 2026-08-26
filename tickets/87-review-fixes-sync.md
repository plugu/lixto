---
id: 87
status: done
model: opus
depends_on: [86]
max_attempts: 4
files:
  - src/lixto/sync/contracts.py
  - src/lixto/sync/plans.py
  - src/lixto/sync/procurements.py
  - src/lixto/sync/details.py
  - src/lixto/sync/results.py
  - src/lixto/status.py
  - tests/test_sync_contracts.py
  - tests/test_sync_plans.py
  - tests/test_sync_procurements.py
  - tests/test_sync_details.py
  - tests/test_sync_results.py
  - tests/test_sync_integration.py
  - tests/conftest.py
---
## Goal
Fix the reviewer's Python sync findings so the first real PNCP page with an incomplete DTO no longer aborts a run, and add one DDL-backed test that would have caught them.

## Context
Reviewer pass over cycle 18 (verified findings; line numbers approximate):
1. `sync/contracts.py:350` blocker — DTO without `orgaoEntidade.cnpj` still INSERTs into `contracts` (`agency_tax_id NOT NULL`) → whole run aborts. Skip DTO (log + counter) when agency tax id is missing, as `upsert_procurement` does.
2. `sync/plans.py:214` blocker — `row_from_plan_dto` may yield `agency_tax_id=None` / `year=None` (both NOT NULL). Return early + counter.
3. `sync/plans.py:63` blocker — local `INSERT INTO agencies (tax_id, name)` with NULL name violates `agencies.name NOT NULL` and `name = EXCLUDED.name` nulls good data. Use `lixto.sync.upsert_agency` / `upsert_buyer_from_dto` (COALESCE + normalize_tax_id).
4. `sync/contracts.py:65` major — same unconditional `EXCLUDED.*` agency upsert and un-normalized `tax_id` (CHAR(14) mismatch vs zero-padded keys). Use the shared helpers.
5. `sync/procurements.py:102` major — guard `EXCLUDED.source_global_updated_at > procurements.source_global_updated_at` is NULL-false; add `procurements.source_global_updated_at IS NULL OR …` (plans/contracts already do).
9. `sync/contracts.py:109` major — contract upsert never resets `amendments_synced_at`; reset it in DO UPDATE when `source_global_updated_at` advanced (mirror `items_synced_at`).
13. `status.py:16` minor — `COUNTED_TABLES` add `procurement_results, procurement_enrichments, procurement_plans, procurement_plan_items, contracts, contract_amendments`.
14. `sync/details.py:184`, `sync/results.py:150` minor — `fetchall()` with `limit=None` loads the whole queue; use batches of 500 in a loop (or server-side cursor).
18. `sync/contracts.py:541` minor — NULL `year`/`sequence` interpolated into the `/termos` URL; skip + log like `details.py`.
10. Tests — add `tests/test_sync_integration.py`: **DDL-backed** test that applies `migrations/001_core.sql` to a scratch database and exercises the four upsert paths (agency w/ missing name, plan w/ missing cnpj/year, contract w/ missing cnpj, procurement w/ NULL global-updated then update). Use `LIXTO_TEST_DATABASE_URL` env (default `postgresql://lixto:lixto@localhost:5433/lixto_test`); create/drop the test DB via a `conftest.py` fixture connecting to the `lixto` maintenance DB; `pytest.skip` when the DB is unreachable so CI without Postgres stays green. Extend the mocked suites for the new skip/counter paths.

## Checks (run in order — cheapest first)
1. `uv run ruff check src tests && uv run ruff format --check src tests`
2. `uv run pytest -q`
3. `docker compose up -d db && uv run pytest -q tests/test_sync_integration.py -rs` — must run (not skip) locally and pass.
4. `uv run lixto status` prints counts for contracts and procurement_plans.

## Done when
- A contract/plan DTO without CNPJ or razão social is skipped with a counter, never aborts; procurements with NULL global-updated get updated; `amendments_synced_at` resets on contract updates; integration test green against the local DB.

## Not included
- Web (88), env/docs (89), per-page watermark for plans (future).
