---
id: 185
status: done
model: sonnet
depends_on: [182]
max_attempts: 3
files:
  - web/lib/match-queries.ts
  - web/lib/match-engine.ts
  - web/lib/match-queries.test.ts
  - web/lib/match-engine.test.ts
  - web/lib/match-batch.test.ts
---
## Goal
The match engine's CNAE, keyword and ME/EPP signals fire for tenders that were only classified at ingest, and the batch match picks those tenders up.

## Context
`web/lib/match-queries.ts`: `buildCandidateQuery` (128-134); CNAE hit arrays 170-179 read `procurement_cnaes` with no origin filter (PK makes codes unique — keep as is, add a test); `enrichmentTerms` feeds `term_hits` and the "at least one signal" predicate (276-293); main SELECT 297-331 takes `me_epp_exclusive` only from `e.me_epp_exclusive`; `WHERE … e.enriched_at > $n` comes from `filters.enrichedSince` (231-255), used by `match-batch.ts:132-137` with the last run's `started_at` → batch only scores tenders whose dossier changed. New table `procurement_classifications (procurement_id PK, status, segment, nature, keywords TEXT[], classified_at, …)` from ticket 182. ME/EPP rule (mirror of Python `derive_me_epp`, analyze/worker.py:344-360): over `procurement_items.benefit_type_id` ignoring NULLs — none left → NULL; all `= 1` → true; else false. `web/lib/match-engine.ts`: `CandidateFacts` 34-53, `scoreCandidate` 78, `me_epp_exclusive` reason 147-153 (weight -40, only `=== true`), `MATCH_ENGINE_VERSION = "1"` (12; bump when a rule changes, ADR 001 §D5). Tests mock `./db` and assert SQL substrings (`match-queries.test.ts:92, 151-159, 422-434`); `match-engine.test.ts` is pure; `match-batch.test.ts` mocks `fetchMatches`.

### Work
1. `match-queries.ts`:
   - Add `LEFT JOIN procurement_classifications pcl ON pcl.procurement_id = p.id AND pcl.status = 'done'` next to the enrichment join.
   - `enrichmentTerms` becomes `coalesce(e.keywords, '{}') || coalesce(e.concepts, '{}') || coalesce(pcl.keywords, '{}')` (keep whatever the current expression already includes; only add the classification keywords). Same expression in the at-least-one-signal predicate.
   - `me_epp_exclusive` column → `coalesce(e.me_epp_exclusive, (SELECT bool_and(i.benefit_type_id = 1) FROM procurement_items i WHERE i.procurement_id = p.id AND i.benefit_type_id IS NOT NULL))`.
   - `enrichedSince` predicate → `(e.enriched_at > $n OR pcl.classified_at > $n)`; rename the filter to `signalsSince` and the SQL comment accordingly (update `match-batch.ts` call site only if the field name changes — it does; keep `match-batch.ts` edits to that one key, and update `match-batch.test.ts` expectations).
   - `fetchMatches` keeps mapping `me_epp_exclusive` as `boolean | null`.
2. `match-engine.ts`: no weight change. Bump `MATCH_ENGINE_VERSION` to `"2"` with a one-line comment (facts now sourced from ingest classification + item benefit).
3. Tests: `match-queries.test.ts` — SQL contains the classification join, `pcl.keywords`, the `bool_and(i.benefit_type_id = 1)` coalesce, `pcl.classified_at > $` in the since predicate, and still contains the unchanged CNAE arrays; a mocked row with `me_epp_exclusive: true` from the item path yields the -40 reason through `fetchMatches`. `match-batch.test.ts` — `fetchMatches` receives `signalsSince`. `match-engine.test.ts` — assert `MATCH_ENGINE_VERSION === "2"`.

## Checks (run in order — cheapest first)
1. `cd web && npm run lint`
2. `cd web && npx tsc --noEmit`
3. `cd web && npx vitest run lib/match-queries.test.ts lib/match-engine.test.ts lib/match-batch.test.ts`

## Done when
- A tender with only ingest classification (no dossier) and a shared CNAE/keyword appears as a candidate with `cnae_*`/`term_enrichment` reasons, and the next batch run scores it.
- A pregão whose items are all `tipoBeneficio = 1` carries the `me_epp_exclusive` penalty for a `MEDIUM`/`LARGE` company without any dossier.

## Not included
- New reason codes or weights (segment match is a later cycle); `/procurements` facets or detail page (186); opportunities UI copy; Python code.
