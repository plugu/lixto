---
id: 75
status: todo
model: opus
depends_on: [74]
max_attempts: 4
files:
  - src/lixto/sync/__init__.py
  - src/lixto/sync/procurements.py
  - src/lixto/sync/details.py
  - src/lixto/sync/backfill.py
  - src/lixto/sync/incremental.py
  - src/lixto/status.py
  - src/lixto/cli/sync.py
  - src/lixto/cli/backfill.py
  - src/lixto/cli/status.py
  - tests/lixto/test_sync_procurements.py
  - tests/lixto/test_sync_details.py
  - tests/lixto/test_backfill.py
  - tests/lixto/test_incremental.py
---
## Goal
`lixto backfill`, `lixto sync incremental` and `lixto sync details` fill `agencies`, `agency_units`, `procurements`, `procurement_items`, `procurement_documents` and `source_payloads` straight from PNCP, resumably.

## Context

Read `PRODUCT.md`, `docs/adr/001-lixto-data-model.md` (DDL + D6 naming map), `docs/PNCP_API.md`. **Port** the proven logic from `src/plic/sync_publicacao.py`, `sync_detalhes.py`, `backfill.py`, `sync_incremental.py`, `status.py` and their tests (`tests/test_sync_*.py`, `test_backfill.py`) — same algorithms (per-modality 7-day chunks, watermarks per modality, `WHERE EXCLUDED.source_global_updated_at > procurements.source_global_updated_at` upsert guard, resumable unit keys in `sync_state`, bounded details drain), new table/column names, English identifiers, `PncpClient` from `src/lixto/pncp_client.py`. Data is pulled only from PNCP endpoints. Wrap every command in `lixto.runs.run(conn, kind=...)`.

### Mapping rules
- `agencies`/`agency_units` upserted from `orgaoEntidade`/`unidadeOrgao` before the procurement row (FK). `tax_id` digits only.
- `procurements`: columns per ADR comments; `kind` of items from `materialOuServico` `M`→`material`, `S`→`service`, else NULL. `source='pncp'`, `source_id=numeroControlePNCP`.
- `source_payloads`: after each upsert write the DTO (`entity_type='procurement'`), and for details the full arrays (`procurement_items`, `procurement_documents`) keyed by `external_id = source_id`.
- No portal allowlist at ingestion (that was a web-side filter); everything published is stored.
- `status.py`: counts per table + open/upcoming/closed procurement counts + watermarks, `lixto status`.

### CLI (`cli/sync.py` exposes `name="sync"` + `app`; `cli/backfill.py` and `cli/status.py` expose `register(root)`)
- `lixto backfill [--since YYYY-MM-DD] [--until] [--modality N…]` (default since 2026-01-01).
- `lixto sync incremental [--since] [--max-details N]` (watermark keys `incremental:procurements:<modality>`).
- `lixto sync details [--limit N]`.
- `lixto status`.

### Tests
Port the legacy test suites 1:1 to the new names (mocked psycopg + mocked client; no network). Add: agencies/units upserted before procurement; `source_payloads` written; `agent_runs` row opened/closed (mock cursor sees the INSERT/UPDATE).

## Checks (run in order — cheapest first)
1. `uv run ruff check src/lixto tests/lixto`
2. `uv run ruff format --check src/lixto tests/lixto`
3. `uv run pytest -q tests/lixto`
4. `uv run lixto sync --help | grep -q incremental && uv run lixto backfill --help >/dev/null && uv run lixto status --help >/dev/null`
5. Live probe (network + local DB up): `uv run lixto backfill --since $(date -v-3d +%F) --until $(date +%F) --modality 6` exits 0 and `docker compose exec -T db psql -U lixto -Atc "select count(*) from procurements"` > 0; then `uv run lixto sync details --limit 20` exits 0 and `select count(*) from procurement_items` > 0; `select count(*) from agent_runs where status='done'` ≥ 2.

## Done when
- A 3-day backfill of one modality populates procurements/agencies/units/items/documents/payloads with the ADR columns; rerun is a no-op; `lixto status` reports counts.

## Not included
- Results (76), plans (77), contracts (78), enrichment (79).
- Any web change; scheduling docs (86).
