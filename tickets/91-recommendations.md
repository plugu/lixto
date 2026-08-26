---
id: 91
status: doing
model: opus
depends_on: [90]
max_attempts: 3
files:
  - web/lib/recommendation-queries.ts
  - web/lib/recommendation-queries.test.ts
  - web/lib/recommend.ts
  - web/lib/recommend.test.ts
  - web/app/api/internal/recommend/run/route.ts
---
## Goal
`POST /api/internal/recommend/run` produces a bounded number of GO/NO-GO recommendations per company per day for its top opportunities, persisted in `recommendations`.

## Context

Read `PRODUCT.md` (bounded GO/NO-GO), ADR D5 (`recommendations`, `opportunities.state`), ticket 90's modules (`opportunity-queries.ts`: `listOpportunities`, `setOpportunityState`, `ATTENTION_SCORE`; `internal-auth.ts`). LLM client: `getChatClient()` from `web/lib/agent/llm.ts` (OpenAI-compatible; env `LIXTO_LLM_API_KEY`/`LIXTO_LLM_BASE_URL`); model env `LIXTO_RECOMMEND_MODEL` default `gpt-5.1` (Tier 3). Company context: `getCompany`, `getCompanyCnaes` (`company-queries.ts`), `getProfile` (`profile-queries.ts`), `fetchEnrichment` (`enrichment-queries.ts` — requirements, risks, delivery, me_epp flags, summary), company documents kinds (`document-queries.ts` — grep its list function; only the `kind` values are needed). Tests: vitest, mocked pool + mocked OpenAI (`chat.completions.create` returning a JSON string), like `web/lib/agent/run.test.ts`.

### `recommendation-queries.ts`
`insertRecommendation(opportunityId, {verdict, rationale, model, confidence})`, `countRecommendationsToday(companyId): Promise<number>` (recommendations joined to opportunities, `created_at >= date_trunc('day', now())`), `listCandidatesForRecommendation(companyId, limit)` = opportunities with state `matched`, latest score ≥ `ATTENTION_SCORE`, no recommendation yet, ordered by score desc.

### `recommend.ts`
- `RECOMMEND_DAILY_CAP = 5`, `RECOMMEND_MODEL`.
- `buildRecommendationPrompt(input)` (pure, exported): system PT-BR "Você é o Lixto… decida GO / NO_GO / BORDERLINE para a empresa participar desta licitação…", user content with: procurement summary (description, agency, state/city, modality, value, closes_at), enrichment (summary, requirements by kind, risks, delivery, me_epp_exclusive/preference, requires_certification/technical_certificate, complexity), company (size, CNAEs, profile products/keywords/exclusions/states/value range, document kinds on file), match score + reasons. Ask for strict JSON `{ "verdict": "go"|"no_go"|"borderline", "rationale": string (≤ 600 chars, PT-BR, cite concrete requirements), "confidence": 0..1 }` via `response_format: { type: "json_object" }`.
- `parseRecommendation(text): {verdict, rationale, confidence} | null` (pure, tolerant).
- `runRecommendBatch(opts?: { companyId?: number; limit?: number; deps?: { client?: OpenAI } })`: `agent_runs` kind `recommend`; per company: remaining = cap − `countRecommendationsToday`; take `listCandidatesForRecommendation(companyId, min(remaining, limit))`; per opportunity: build prompt → call → parse → `insertRecommendation` → `setOpportunityState(companyId, id, "recommended")`; per-item try/catch (logged, counted, never aborts). Counters `{companies, recommended, skipped_cap, failed}`. No API key → the run completes with `failed = candidates` and a clear error string in `agent_runs.error`.
- Route `POST /api/internal/recommend/run` guarded by `isInternalRequest`; body `{ companyId?, limit? }`.

### Tests
Prompt contains the requirement descriptions and company CNAEs; parse tolerates fences/invalid → null; cap respected (`countRecommendationsToday = 4` → 1 call); state set to `recommended` only on success; missing key path.

## Checks (run in order — cheapest first)
1. `cd web && npx tsc --noEmit`
2. `cd web && npm run lint`
3. `cd web && npm test`
4. `cd web && npm run build`
5. Local probe: after ticket 90's probe left opportunities ≥ 70 (or lower `minScore` by inserting a strong profile), with `LIXTO_LLM_API_KEY` set: `curl -s -X POST -H 'x-lixto-internal-token: t' localhost:3101/api/internal/recommend/run` → 200 with `recommended ≥ 1`; `select verdict, left(rationale,60) from recommendations` shows rows. Without a key: 200 with `failed > 0` and an `agent_runs` row `status='done'` carrying the error text. Skip the keyed half and say so if no key.

## Done when
- A company never gets more than 5 recommendations per day; each recommended opportunity has state `recommended` and one `recommendations` row with a PT-BR rationale.

## Not included
- UI (93), tools (94), CLI (92), any prepare/execute action.
