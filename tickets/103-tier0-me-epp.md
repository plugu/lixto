---
id: 103
status: doing
model: sonnet
depends_on: [102]
max_attempts: 3
files:
  - src/lixto/enrich/worker.py
  - src/lixto/enrich/schema.py
  - tests/test_enrich_worker.py
  - tests/test_enrich_schema.py
---
## Goal
`me_epp_exclusive` / `me_epp_preference` come deterministically from `procurement_items.benefit_type_id` (PNCP `tipoBeneficio`), and the LLM is no longer asked for them.

## Context

PNCP item field `tipoBeneficioId`: 1 = participação exclusiva ME/EPP, 2 = subcontratação ME/EPP, 3 = cota reservada ME/EPP, 4 = sem benefício, 5 = não se aplica. Stored per item in `procurement_items.benefit_type_id` (details sync, ~100 % coverage). Today `worker._persist` writes `payload["me_epp_exclusive"]` / `["me_epp_preference"]` from the LLM; `schema.ENRICHMENT_SCHEMA` requires both; `INSTRUCTIONS` describes them. Consumers (`web/lib/match-engine.ts`, `recommend.ts`, `enrichment-queries.ts`) read the two columns on `procurement_enrichments` — unchanged.

Changes:
1. `schema.py`: remove `me_epp_exclusive` and `me_epp_preference` from `ENRICHMENT_SCHEMA.properties` and `required`; `validate_payload` must not require them (accept and drop if a model still emits them). Bump nothing else — `SCHEMA_VERSION` stays (columns unchanged; note in docstring that the two flags are Tier-0 since cycle 21).
2. `worker.py`:
   - `_SELECT_ITEMS_SQL` adds `benefit_type_id` (keep `LIMIT max_items` for the prompt, but derive flags from **all** items: add `_SELECT_BENEFITS_SQL = "SELECT benefit_type_id FROM procurement_items WHERE procurement_id = %(procurement_id)s"`).
   - `derive_me_epp(benefit_ids: list[int | None]) -> tuple[bool | None, bool | None]`: no items or all `None` → `(None, None)`; exclusive = every non-null id == 1 and at least one item; preference = any id in {2, 3} (or exclusive on some but not all items → preference True, exclusive False).
   - `_persist(..., me_epp: tuple[bool|None, bool|None])` writes those instead of the payload's; `payload` stored in `data` unchanged.
   - Prompt: add one line `Benefício ME/EPP (PNCP): exclusivo / cota reservada / nenhum` from the derived flags so the model can weigh it in `risks`/`requirements`, and remove the two bullets from `INSTRUCTIONS`.
3. Tests: `derive_me_epp` truth table (all 1 → (True, False); mix 1/4 → (False, True); 3 present → (False, True); all 4/5 → (False, False); empty → (None, None)); `_persist` receives derived values; schema no longer requires the fields; `validate_payload` tolerates their presence.

## Checks (run in order — cheapest first)
1. `uv run ruff check src tests && uv run ruff format --check src tests`
2. `uv run pytest tests/test_enrich_worker.py tests/test_enrich_schema.py -q`
3. `uv run pytest -q`

## Done when
- A procurement whose items are all `benefit_type_id=1` is persisted with `me_epp_exclusive=true` regardless of what the LLM returns; `ENRICHMENT_SCHEMA["required"]` lacks both flags.

## Not included
- Other Tier-0 fields (lot structure, judging criterion, deadline pressure).
- Schema v1.1 / `origin` column / ADR.
- Web changes.
