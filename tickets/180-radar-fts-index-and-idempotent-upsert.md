---
id: 180
status: done
model: sonnet
depends_on: []
max_attempts: 3
files:
  - web/lib/radar-match-queries.ts
  - web/lib/radar-match-queries.test.ts
  - web/lib/radar-batch.ts
  - web/lib/radar-batch.test.ts
---
## Goal
Radar's title FTS matches its GIN index, and the horizon upsert rewrites a `future_opportunities` row only when something changed.

## Context
`web/lib/radar-match-queries.ts:74-78`: `to_tsvector('portuguese', f_unaccent(coalesce(fo.title, '')))`. The index (`migrations/005_radar.sql:58`) is `gin (to_tsvector('portuguese', f_unaccent(title)))` — the `coalesce` makes the expression differ textually, so the index is never used. `title` is `NOT NULL` in the same migration (verify with grep; if nullable, `to_tsvector` of NULL is NULL and the surrounding `CASE … THEN false` guard already handles a NULL tsquery — a NULL row simply doesn't match). `web/lib/radar-batch.ts:129-146` `UPSERT_TAIL`: `ON CONFLICT (plan_id, item_number) DO UPDATE SET … updated_at = now()` with no change guard; `status` moves `expired → predicted` in the same SET. `signals` is `JSONB NOT NULL` (jsonb supports `IS DISTINCT FROM`); `estimated_value NUMERIC`, `expected_date DATE`. Tests assert on SQL text (`radar-batch.test.ts:206` `toContain("ON CONFLICT (plan_id, item_number) DO UPDATE")`).

### Work
1. `radar-match-queries.ts`: change the expression to `to_tsvector('portuguese', f_unaccent(fo.title))` (drop `coalesce`), add a comment pointing at the index definition and the "textually identical" rule. Test: built text contains `f_unaccent(fo.title))` and not `coalesce(fo.title`.
2. `radar-batch.ts` `UPSERT_TAIL`: append
   `WHERE future_opportunities.status = 'expired' OR (future_opportunities.agency_tax_id, future_opportunities.state, future_opportunities.title, future_opportunities.pdm_code, future_opportunities.category_name, future_opportunities.estimated_value, future_opportunities.expected_date, future_opportunities.plan_year, future_opportunities.opportunity_score, future_opportunities.signals, future_opportunities.engine_version) IS DISTINCT FROM (EXCLUDED.agency_tax_id, EXCLUDED.state, EXCLUDED.title, EXCLUDED.pdm_code, EXCLUDED.category_name, EXCLUDED.estimated_value, EXCLUDED.expected_date, EXCLUDED.plan_year, EXCLUDED.opportunity_score, EXCLUDED.signals, EXCLUDED.engine_version)`.
   Comment: unchanged rows keep `updated_at`; the `expired` clause keeps the status resurrection working when nothing else changed. If `runRadarBatch` derives a counter from the upsert's `rowCount`, keep it meaning "rows written" (document) — do not break the returned counters' names.
3. Tests: upsert text contains `IS DISTINCT FROM` and `status = 'expired' OR`; existing upsert/paging tests unchanged.

## Checks (run in order — cheapest first)
1. `cd web && npm run lint`
2. `cd web && npx tsc --noEmit`
3. `cd web && npx vitest run lib/radar-match-queries.test.ts lib/radar-batch.test.ts lib/radar-engine.test.ts`
4. `cd web && ! grep -q "coalesce(fo.title" lib/radar-match-queries.ts && grep -q 'IS DISTINCT FROM' lib/radar-batch.ts`

## Done when
- All checks green; the FTS expression is textually identical to the index; unchanged horizon rows are not rewritten.

## Not included
- `plan_item_embeddings` preservation on plan replace (Radar go-live cycle); the correlated `agency_units` subquery in `HORIZON_SQL`; per-company Radar match upsert (`computed_at`) changes; enabling any Radar schedule.
