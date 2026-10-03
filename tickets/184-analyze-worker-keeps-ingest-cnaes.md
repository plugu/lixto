---
id: 184
status: done
model: haiku
depends_on: [182]
max_attempts: 3
files:
  - src/lixto/analyze/worker.py
  - tests/test_analyze_worker.py
---
## Goal
A deep analysis never erases ingest CNAEs, and a dossier CNAE wins over an ingest CNAE with the same code.

## Context
`src/lixto/analyze/worker.py:161-166`: `_DELETE_CNAES_SQL = "DELETE FROM procurement_cnaes WHERE procurement_id = %(id)s"` and `_INSERT_CNAE_SQL` inserts with `origin 'enrichment'` and `ON CONFLICT DO NOTHING`; both run in `_persist` (401-515, CNAE block 486-495). After ticket 182 `procurement_cnaes.origin` also allows `'ingest'` (written by `lixto classify run`, PK `(procurement_id, cnae_code)`). Categories (`_DELETE_CATEGORIES_SQL`, 148) stay dossier-only and unchanged. Tests: `tests/test_analyze_worker.py` (mocked conn `_conn()` at 182, `_llm()` at 173, `patched` fixture 220).

### Work
1. `_DELETE_CNAES_SQL` → `DELETE FROM procurement_cnaes WHERE procurement_id = %(id)s AND origin = 'enrichment'`.
2. `_INSERT_CNAE_SQL` → `… ON CONFLICT (procurement_id, cnae_code) DO UPDATE SET confidence = EXCLUDED.confidence, origin = 'enrichment'`.
3. Update the module docstring/comment near the constants: ingest rows (`origin = 'ingest'`) are owned by `lixto classify run`; the dossier overrides same-code rows and leaves the rest.
4. Tests: assert the two constants contain `origin = 'enrichment'` / `DO UPDATE SET confidence`, and that a done analysis executes the scoped delete (inspect the mocked cursor's `execute` calls as the existing persist tests do).

## Checks (run in order — cheapest first)
1. `uv run ruff check src tests && uv run ruff format --check src tests`
2. `uv run pytest -q tests/test_analyze_worker.py`
3. `grep -q "AND origin = 'enrichment'" src/lixto/analyze/worker.py`

## Done when
- Re-analysing a tender leaves its `origin='ingest'` CNAE rows in place and upgrades shared codes to `origin='enrichment'`.

## Not included
- Any change to categories, requirements, embeddings or the enrichment upsert; any classify code.
