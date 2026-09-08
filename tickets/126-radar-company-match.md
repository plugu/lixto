---
id: 126
status: done
model: sonnet
depends_on: [124]
max_attempts: 3
files:
  - web/lib/radar-engine.ts
  - web/lib/radar-engine.test.ts
  - web/lib/radar-match-queries.ts
  - web/lib/radar-match-queries.test.ts
  - web/lib/radar-batch.ts
  - web/lib/radar-batch.test.ts
  - web/lib/tenant-isolation.test.ts
---
## Goal
`runRadarBatch` scores every `predicted` future opportunity against each company profile and persists `future_opportunity_matches`, so `POST /api/internal/radar/run` returns `{ runId, opportunities, expired, companies, matched }`.

## Context
Cycle 24 Radar (PRODUCT.md): company-match score is deterministic and **separate** from the opportunity score. Ticket 124 built the tables, `radar-engine.ts` (opportunity side), `radar-batch.ts` (detection + expiry) and the route, which already forwards `{ companyId }`.

**Engine addition** in `web/lib/radar-engine.ts` — `scoreCompanyMatch(f: RadarCandidateFacts, p: ProfileSummary & { exclusion_terms: string[] }): { score, reasons: Reason[] }`. Reuse `Reason`/`ReasonCode` and `ProfileSummary` types from `./match-engine` (import, don't redefine). Facts: `{ id, state: string|null, estimated_value: string|null, text_hit: boolean, exclusion_hit: boolean, similarity: number|null }`. Rules (raw weights kept on reasons, sum clamped 0–100): `term_text` +40; `semantic_high` (sim ≥ 0.55) +35 else `semantic` (sim ≥ 0.40) +20; `state_ok` +15 when profile states empty or contains state, `state_out` −30 when state known and not in profile states, state NULL → no reason; `value_ok` +10 inside `[min,max]`, `value_out` −20 outside, `value_unknown` 0; `exclusion` −60; `no_profile` when terms empty and similarity null (score 0). Export `RADAR_MATCH_MIN = 40` — below it nothing is persisted.

**`web/lib/radar-match-queries.ts`** — model on `web/lib/match-queries.ts` (pure builders + thin async wrappers; `companyId` always `$1`; relative imports). Export:
- `buildRadarCandidateQuery(companyId, profile, candidateLimit = 500): SqlQuery` — from `future_opportunities fo` with `status = 'predicted'`; `text_hit` = `to_tsvector('portuguese', f_unaccent(fo.title)) @@ to_tsquery('portuguese', $terms)` using `buildTermsTsQuery` imported from `./match-queries`; `exclusion_hit` likewise on `exclusion_terms`; `similarity` from a CTE `s` = top-K (`SEMANTIC_TOP_K = 500`) of `plan_item_embeddings e JOIN future_opportunities fo2 ON (fo2.plan_id, fo2.item_number) = (e.plan_id, e.item_number)` ordered by `e.embedding <=> $vector::vector`, `1 - distance AS similarity`; candidates = `text_hit OR s.similarity >= 0.40`. No profile embedding → `NULL::real AS similarity` and no CTE (same trick as `match-queries.ts:187`).
- `loadRadarProfile(companyId)` — reuse the same three loads as `match-queries.ts:303` (`getProfile`, `companies.size`, profile embedding); defaults when no profile row.
- `upsertRadarMatches(companyId, rows: { id, score, reasons }[])` multi-row upsert on `(company_id, future_opportunity_id)`; `pruneRadarMatches(companyId)` deletes this company's rows whose opportunity is no longer `predicted` **or** whose id is not in the just-scored set with score ≥ `RADAR_MATCH_MIN` (pass the kept ids as `$2::bigint[]`).
- `listCompaniesWithProfile(): Promise<number[]>` (`SELECT company_id FROM company_profiles ORDER BY company_id`).

**Batch**: ticket 124 left a "ticket 126 hook" comment in `runRadarBatch` *between* the upsert loop and the expiry step — move the matching pass to run **after** expiry (so `status='predicted'` is final when candidates are read). Then in `runRadarBatch({ companyId? })`, loop companies (one or all); per company: load profile → candidates → `scoreCompanyMatch` → upsert those ≥ min → prune. Per-company failures counted, first error wins `agent_runs.error`, run still `done` for the rest (same policy as `match-batch.ts`). Counters `companies`, `matched`, `failed` added to the return and to `agent_runs.counters`.

Register `buildRadarCandidateQuery` and both mutation builders in `web/lib/tenant-isolation.test.ts` (asserts `company_id` bound as `$1`).

## Checks (run in order — cheapest first)
1. `cd web && npm run lint`
2. `cd web && npx vitest run lib/radar-engine.test.ts lib/radar-match-queries.test.ts lib/radar-batch.test.ts lib/tenant-isolation.test.ts`
3. `cd web && npm run build`
4. `cd web && npm test`

## Done when
- With a company whose profile has `terms` that appear in some `future_opportunities.title`, `curl -s -X POST -H "x-lixto-internal-token: $LIXTO_INTERNAL_TOKEN" -d '{"companyId":<id>}' localhost:3000/api/internal/radar/run` returns `matched > 0` and `SELECT * FROM future_opportunity_matches WHERE company_id = <id>` shows rows with `reasons` containing `term_text`; editing the profile to unrelated terms and rerunning prunes them.
- Without any `plan_item_embeddings` rows the run still succeeds (similarity path degrades to NULL).

## Not included
- UI (127/128), Python CLI (125), docs (130).
- CNAE-based reasons (PCA items carry no CNAE; V2 if ever).
- Any change to `match-engine.ts` / `match-queries.ts` beyond importing from them.
