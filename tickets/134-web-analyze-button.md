---
id: 134
status: done
model: sonnet
depends_on: [132]
max_attempts: 3
files:
  - web/lib/analysis-queries.ts
  - web/lib/analysis-queries.test.ts
  - web/app/(app)/procurement/[sourceId]/actions.ts
  - web/components/analyze-button.tsx
  - web/app/(app)/procurement/[sourceId]/page.tsx
---
## Goal
An "Analisar com IA" button on the procurement detail page enqueues an `analysis_jobs` row (per-company daily cap) and polls until the dossier exists, then refreshes the page.

## Context
Cycle 25 (PRODUCT.md). Tables: `migrations/006_tender_analysis.sql` (ticket 131) — `analysis_jobs (id, procurement_id, company_id, requested_by_user_id, status queued|running|done|error, error, created_at, started_at, finished_at)` and `tender_analyses (procurement_id, version, status, document_set_hash, analyzed_at, ...)`. The Python drain (ticket 133) runs every 2 min, so a job takes 1–5 min. Session: `requireSession()` from `web/lib/auth.ts` gives `session.user.companyId` and `session.user.id` — never take either from the caller. Query style: `web/lib/document-queries.ts` (pure `build*` SQL builders returning `{text, values}` tested in vitest + thin async wrappers on the shared `pool` from `./db`; relative imports inside `lib/`). Server action + client component pattern: `web/app/(app)/opportunities/actions.ts` and `web/components/opportunity-feedback.tsx`. UI primitives: `web/components/ui/button.tsx` (`Button`, variants `primary|secondary|ghost`), `web/components/ui/icons.tsx` (`Alert`, `Check`).

### `web/lib/analysis-queries.ts`
- `DOCUMENT_SET_HASH_SQL` — copy verbatim from `src/lixto/analyze/worker.py` (replace `%(procurement_id)s` with `$1`). Both sides must produce the same md5 for the same rows; add a comment saying so.
- `export type AnalysisSummary = { version: number; status: 'done' | 'error'; error: string | null; document_set_hash: string | null; analyzed_at: Date; }`
- `export type AnalysisJob = { id: number; status: 'queued'|'running'|'done'|'error'; error: string | null; created_at: Date; }`
- Builders + wrappers: `buildFetchAnalysisSummary(procurementId)`, `buildCurrentDocumentSetHash(procurementId)`, `buildLatestJob(procurementId, companyId)` (newest row for that pair), `buildCountJobsToday(companyId)` (`created_at >= date_trunc('day', now())`, all statuses), `buildInsertJob(procurementId, companyId, userId)` (`RETURNING id, status, error, created_at`).
- `export const ANALYZE_USER_DAILY_CAP = Number(process.env.LIXTO_ANALYZE_USER_DAILY_CAP ?? 10)` (0 = unlimited).
- `export type AnalysisState = { analysis: AnalysisSummary | null; stale: boolean; job: AnalysisJob | null }` and `getAnalysisState(procurementId, companyId)`: `stale = analysis !== null && analysis.document_set_hash !== currentHash`; `job` is the latest job only while `queued|running` (a finished job is not "active" — return it only if `finished_at` is within the last 10 minutes so the UI can show "Análise concluída" / an error once).
- `enqueueAnalysis(procurementId, companyId, userId): Promise<{ ok: true; job: AnalysisJob } | { error: string }>` — in order: active job exists → return it as ok; analysis exists, `status='done'` and not stale → `{ error: "Esta licitação já foi analisada." }`; cap > 0 and count today ≥ cap → `{ error: "Limite diário de análises atingido (N)." }`; otherwise insert. The procurement must be open or upcoming: check `proposal_closes_at >= now() OR proposal_opens_at > now()` in the same query as the insert (`INSERT ... SELECT ... WHERE EXISTS (...)`, zero rows → `{ error: "Só licitações abertas podem ser analisadas." }`).

### `web/app/(app)/procurement/[sourceId]/actions.ts` (`"use server"`)
- `enqueueAnalysisAction(procurementId: number)` → `requireSession()` → `enqueueAnalysis(...)`; on ok `revalidatePath` of the procurement page is **not** needed (client polls).
- `analysisStatusAction(procurementId: number)` → `requireSession()` → `getAnalysisState(...)` serialized (dates as ISO strings).

### `web/components/analyze-button.tsx` (`"use client"`)
Props: `procurementId`, `initial: { hasAnalysis: boolean; stale: boolean; job: {status, error} | null }`. Renders:
- no active job: `Button` primary `Analisar com IA` (or `Reanalisar — documentos atualizados` when `stale`); click → `enqueueAnalysisAction`; error → red text under the button.
- job `queued|running`: disabled button `Analisando… (1–5 min)` with a small spinner, polling `analysisStatusAction` every 5 s (`setInterval`, cleared on unmount); when the job reaches `done` → `router.refresh()`; `error` → show `Falha na análise: {error}` and re-enable the button.
No new dependencies.

### Page wiring (`page.tsx`)
Fetch `getAnalysisState(detail.id, session.user.companyId)` in the existing `Promise.all` (keep `requireSession()`'s return value). Render `<AnalyzeButton>` inside the header `Card` under the status badge when `status !== 'closed'` and (`analysis === null` or `stale` or active job). Do not touch the `EnrichmentPanel` block (ticket 135 replaces it).

Tests (`analysis-queries.test.ts`): every builder's SQL text/params, `ANALYZE_USER_DAILY_CAP` default, `enqueueAnalysis` decision order with a mocked `pool.query` (active job short-circuit, already-analysed, cap reached, closed procurement, happy path). Add nothing to `tenant-isolation.test.ts` unless its existing scan now flags the new module — if it does, satisfy it the way the other modules do.

## Checks (run in order — cheapest first)
1. `cd web && npm run lint`
2. `cd web && npx next typegen && npx tsc --noEmit`
3. `cd web && npm test`
4. `cd web && npm run build`

## Done when
- On the dev stack (`docker-compose` DB with a synced open procurement, `LIXTO_INTERNAL_TOKEN` not required), opening `/procurement/<id>` shows "Analisar com IA"; clicking inserts an `analysis_jobs` row for the session's company and the button shows the analysing state; after `uv run lixto analyze jobs` finishes, the page refreshes on its own.
- A second click while a job is active does not insert a second row; the 11th request of the day returns the cap error.

## Not included
- Rendering the dossier (ticket 135) — the page still shows `EnrichmentPanel`.
- Email/notification on completion; job history UI.
- Any Python change.
