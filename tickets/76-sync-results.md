---
id: 76
status: todo
model: sonnet
depends_on: [75]
max_attempts: 4
files:
  - src/lixto/sync/results.py
  - src/lixto/cli/results.py
  - tests/lixto/test_sync_results.py
---
## Goal
`lixto sync results` drains the demand queue of items and stores homologated results (winner, unit price) in `procurement_results`.

## Context

Read `docs/adr/001-lixto-data-model.md` (`procurement_results`, `procurement_items.results_requested_at/results_synced_at`, `source_payloads` entity `procurement_results` with `external_id = '<source_id>#<item_number>'`) and `docs/PNCP_API.md` — especially the **pagination trap**: `/itens/{n}/resultados` ignores `pagina`; fetch page 1 only. Port `src/plic/sync_resultados.py` + `tests/test_sync_resultados.py` (the `_FirstPageOnly` wrapper) to the new names; `PncpClient.fetch_item_results` from ticket 74. Wrap in `lixto.runs.run(conn, kind="sync.results")`. Data from PNCP only.

- Select items with `results_requested_at IS NOT NULL AND results_synced_at IS NULL` (partial index exists) joined to `procurements` for `agency_tax_id/year/sequence`, `LIMIT`.
- Upsert results; stamp `results_synced_at = now()` even when zero results; commit per item.
- `cli/results.py`: `register(root)` adding `lixto sync results [--limit N]`? — no: `sync` is owned by ticket 75's `cli/sync.py`. Expose instead `name = "results"` with `app` containing `sync` → command is `lixto results sync [--limit N]`. Document in `--help`.

## Checks (run in order — cheapest first)
1. `uv run ruff check src/lixto tests/lixto`
2. `uv run ruff format --check src/lixto tests/lixto`
3. `uv run pytest -q tests/lixto`
4. `uv run lixto results sync --help | grep -q -- --limit`
5. Live probe (DB with items from ticket 75): `docker compose exec -T db psql -U lixto -c "update procurement_items set results_requested_at = now() where (procurement_id, item_number) in (select procurement_id, item_number from procurement_items limit 5)"` then `uv run lixto results sync --limit 5` exits 0 and `select count(*) from procurement_items where results_synced_at is not null` = 5.

## Done when
- Queued items get `procurement_results` rows (or none) and leave the queue; a second run processes 0.

## Not included
- Web price benchmark (81); enqueueing from the web (81).
