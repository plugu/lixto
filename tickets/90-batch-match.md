---
id: 90
status: doing
model: opus
depends_on: []
max_attempts: 3
files:
  - web/lib/match-engine.ts
  - web/lib/match-queries.ts
  - web/lib/match-queries.test.ts
  - web/lib/opportunity-queries.ts
  - web/lib/opportunity-queries.test.ts
  - web/lib/match-batch.ts
  - web/lib/match-batch.test.ts
  - web/lib/internal-auth.ts
  - web/lib/internal-auth.test.ts
  - web/app/api/internal/match/run/route.ts
  - web/.env.example
---
## Goal
`POST /api/internal/match/run` scores every company against procurements enriched since its last run, using the existing scoring rule, and persists `matches` + `opportunities`.

## Context

Read `PRODUCT.md` and `docs/adr/001-lixto-data-model.md` (D5: `matches`, `opportunities`, `agent_runs`). **One scoring implementation**: the batch reuses `scoreCandidate` (`web/lib/match-engine.ts`) and `buildCandidateQuery`/`fetchMatches` (`web/lib/match-queries.ts`) — nothing is ported to Python. The batch runs inside the web process behind an internal, token-guarded route; the CLI (ticket 92) only triggers it. Conventions: bound `$n` params, relative imports in `lib/`, vitest with mocked `pool` (see `web/lib/match-queries.test.ts`). `web/AGENTS.md` for route handlers (Next 16.3).

### `match-engine.ts`
Add `export const MATCH_ENGINE_VERSION = "1";` (bump when weights change). No other change.

### `match-queries.ts`
- `MatchFilters` gains `enrichedSince?: Date` → predicate `e.enriched_at > $n` (requires the enrichment join to be non-null for that filter; keep existing behaviour otherwise).
- `fetchMatches(companyId, filters, limit = 20, candidateLimit = CANDIDATE_LIMIT)` — expose the candidate cap as an optional 4th arg (batch uses 500). Existing callers unchanged.
- Tests for both.

### `opportunity-queries.ts`
```ts
export type OpportunityState = "discovered"|"matched"|"analyzed"|"recommended"|"preparing"|"awaiting_approval"|"executed"|"dismissed";
export type OpportunityRow = { id: number; company_id: number; procurement_id: number; source_id: string; state: OpportunityState; score: number; reasons: Reason[]; attention: boolean; computed_at: Date; description: string|null; agency_name: string|null; state_uf: string|null; city_name: string|null; modality_name: string|null; estimated_value: string|null; proposal_closes_at: Date|null; verdict: "go"|"no_go"|"borderline"|null; rationale: string|null };
export async function insertMatch(companyId: number, procurementId: number, score: number, reasons: Reason[], engineVersion: string): Promise<void>;
export async function upsertOpportunity(companyId: number, procurementId: number): Promise<{ id: number; created: boolean }>; // ON CONFLICT (company_id, procurement_id) DO UPDATE SET updated_at = now() — never regress state
export async function listOpportunities(companyId: number, opts: { states?: OpportunityState[]; minScore?: number; limit?: number; sinceRunAt?: Date }): Promise<OpportunityRow[]>; // latest match per pair via DISTINCT ON (company_id, procurement_id) ORDER BY computed_at DESC; latest recommendation via LEFT JOIN LATERAL; attention = score >= 70; order score DESC, proposal_closes_at ASC
export async function getOpportunity(companyId: number, sourceId: string): Promise<OpportunityRow | null>;
export async function setOpportunityState(companyId: number, opportunityId: number, state: OpportunityState): Promise<void>; // binds both ids
export async function insertFeedback(companyId: number, opportunityId: number, userId: number, kind: "accepted"|"rejected", reason: string | null): Promise<void>; // verifies the opportunity belongs to companyId in the same statement
export async function getLastRun(kind: string, companyId?: number): Promise<{ id: number; started_at: Date; finished_at: Date | null; counters: Record<string, number>; status: string } | null>;
```
Thresholds are module constants: `ATTENTION_SCORE = 70`, `MATCH_SCORE = 40`.

### `match-batch.ts`
`export async function runMatchBatch(opts?: { companyId?: number; since?: Date; candidateLimit?: number }): Promise<{ runId: number; companies: number; scored: number; matched: number; attention: number }>`:
1. Insert `agent_runs` (`kind='match'`, `status='running'`) — company_id NULL for the global run; `since` defaults to the `started_at` of the last `done` global `match` run, else epoch.
2. Companies = `SELECT id FROM companies WHERE EXISTS (company_profiles) OR EXISTS (company_cnaes)`.
3. Per company: `fetchMatches(companyId, { statuses: ["open","upcoming"], enrichedSince: since }, 1000, candidateLimit ?? 500)`; for each row with `score >= MATCH_SCORE`: `insertMatch` + `upsertOpportunity` (new rows start `discovered` → immediately `matched` via `setOpportunityState` when created; existing rows untouched). Per-company try/catch: a failing company is logged and counted, never aborts the run.
4. Close the run with counters `{companies, scored, matched, attention, failed}`; on unexpected error mark `failed` and rethrow.

### `internal-auth.ts` + route
`export function isInternalRequest(req: Request): boolean` — constant-time compare of header `x-lixto-internal-token` with `process.env.LIXTO_INTERNAL_TOKEN`; false when the env is unset. Route `POST /api/internal/match/run` (`runtime = "nodejs"`, `maxDuration = 300` if the Next version supports it): 401 when not internal; body `{ companyId?: number; since?: string }` optional; returns `200 { runId, companies, scored, matched, attention }`; errors → 500 `{ error }`. Document `LIXTO_INTERNAL_TOKEN` in `web/.env.example`.

### Tests
`match-batch.test.ts` (mock `match-queries`, `opportunity-queries`, `pool`): since defaults from last run; only rows ≥ 40 persisted; created opportunities get `matched`; one failing company doesn't stop others; counters. `internal-auth.test.ts`: unset env → false; wrong/right token. `opportunity-queries.test.ts`: SQL binds `companyId`; `listOpportunities` `DISTINCT ON` + attention flag mapping.

## Checks (run in order — cheapest first)
1. `cd web && npx tsc --noEmit`
2. `cd web && npm run lint`
3. `cd web && npm test`
4. `cd web && npm run build`
5. Local probe (DB has procurements; insert one enrichment row by hand if none: `insert into procurement_enrichments (procurement_id, schema_version, status, input_kind, data, keywords) select id,'1.0','done','structured','{}','{lapis,caneta}' from procurements limit 3`; company id 1 exists with a profile containing `lapis`): `LIXTO_INTERNAL_TOKEN=t npm run start -- -p 3101 &`, `curl -s -X POST -H 'x-lixto-internal-token: t' localhost:3101/api/internal/match/run` → 200 JSON with `scored > 0`; without header → 401; `select count(*) from matches; select state, count(*) from opportunities group by 1` non-empty. Kill server.

## Done when
- Two consecutive runs: the second scores 0 new rows (since = last run) and creates no duplicate `matches`; `opportunities` unique per pair.

## Not included
- Recommendations (91), CLI (92), UI (93), tools (94).
