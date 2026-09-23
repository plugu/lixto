---
id: 168
status: done
model: opus
depends_on: []
max_attempts: 3
files:
  - migrations/008_cases.sql
  - scripts/dev/case-fixture.sql
  - web/lib/case-verdict.ts
  - web/lib/case-verdict.test.ts
  - web/lib/case-queries.ts
  - web/lib/case-queries.test.ts
  - web/lib/case-batch.ts
  - web/lib/case-batch.test.ts
  - web/lib/tenant-isolation.test.ts
  - web/app/api/internal/cases/run/route.ts
  - web/app/api/internal/cases/run/route.test.ts
  - src/lixto/internal_api.py
  - src/lixto/cli/cases.py
  - tests/test_internal_api.py
  - tests/test_cli_cases.py
---
## Goal
`lixto cases run` turns every GO recommendation into a **case** with a computed habilitação verdict — one check line per requirement × document kind, each `met` / `expiring` / `missing` / `manual` — persisted in two new tables. Zero LLM calls.

## Context
Batch logic lives in the web app; the Python CLI is a thin HTTP trigger (`src/lixto/cli/recommend.py` → `InternalApi.recommend_run` in `src/lixto/internal_api.py` → `web/app/api/internal/recommend/run/route.ts`). Copy that shape exactly. Run bookkeeping: copy `startRun`/`finishRun` from `web/lib/match-batch.ts:74-96` with kind `'cases'`. Inside `web/lib` use relative imports (vitest has no `@/` alias there); under `web/app` use `@/`.

Inputs already in the repo:
- Dossier: `fetchAnalysis(procurementId)` in `web/lib/analysis-queries.ts` (null when absent or `status='error'`). `AnalysisRequirement` = `{sequence, category, title, description, mandatory, severity, citations}`; `AnalysisDate` = `{sequence, kind, occurs_at, confidence}`.
- Company documents: `listDocuments(companyId)` in `web/lib/document-queries.ts` → `DocumentRow` `{id, kind, file_name, valid_until: Date|null, expired}`. Kinds: `DocumentKind` in `web/lib/types.ts`.
- On-demand analysis: `enqueueAnalysis(procurementId, companyId, userId)` in `analysis-queries.ts` — needs a user id (use the company's lowest-id `admin`), respects the per-company cap, returns `{error}` when capped / closed / already analysed. Treat any non-`ok` as "still waiting", never throw.
- Recommendation rows: `recommendations (opportunity_id, verdict, created_at)`; opportunities: `opportunities (id, company_id, procurement_id, state)`. Schema in `migrations/001_core.sql` (do not alter; ADR 001). `tests/test_db.py` only pins that 007 follows 006 — a new 008 is fine.

### Work
1. **`migrations/008_cases.sql`** (comment header: `-- Cycle 30 (ticket 168): case agent V1.`):
   ```sql
   CREATE TABLE cases (
       id                   BIGSERIAL PRIMARY KEY,
       company_id           BIGINT NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
       procurement_id       BIGINT NOT NULL REFERENCES procurements (id) ON DELETE CASCADE,
       opportunity_id       BIGINT NOT NULL UNIQUE REFERENCES opportunities (id) ON DELETE CASCADE,
       recommendation_id    BIGINT REFERENCES recommendations (id) ON DELETE SET NULL,
       status               TEXT NOT NULL DEFAULT 'waiting_analysis' CHECK (status IN ('waiting_analysis','ready','decided')),
       analysis_version     INTEGER,
       session_at           TIMESTAMPTZ,
       session_source       TEXT CHECK (session_source IN ('dossier_session','dossier_proposal_deadline','procurement_closes_at')),
       email_enqueued_at    TIMESTAMPTZ,
       decision             TEXT CHECK (decision IN ('submit','skip','missing_document')),
       decision_note        TEXT,
       decided_by           BIGINT REFERENCES users (id) ON DELETE SET NULL,
       decided_at           TIMESTAMPTZ,
       results_requested_at TIMESTAMPTZ,
       outcome              TEXT CHECK (outcome IN ('won','lost','disqualified')),
       outcome_source       TEXT CHECK (outcome_source IN ('pncp','operator')),
       outcome_at           TIMESTAMPTZ,
       created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
       updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
   );
   CREATE INDEX idx_cases_company_status ON cases (company_id, status, session_at);
   CREATE INDEX idx_cases_outcome_sweep ON cases (session_at) WHERE decision = 'submit' AND outcome IS NULL;

   CREATE TABLE case_checks (
       id                    BIGSERIAL PRIMARY KEY,
       case_id               BIGINT NOT NULL REFERENCES cases (id) ON DELETE CASCADE,
       requirement_sequence  INTEGER NOT NULL,
       category              TEXT NOT NULL,
       title                 TEXT NOT NULL,
       mandatory             BOOLEAN NOT NULL,
       severity              TEXT NOT NULL,
       citations             JSONB NOT NULL DEFAULT '[]',
       document_kind         TEXT,                         -- NULL iff status = 'manual'
       status                TEXT NOT NULL CHECK (status IN ('met','expiring','missing','manual')),
       document_id           BIGINT REFERENCES company_documents (id) ON DELETE SET NULL,
       document_file_name    TEXT,
       document_valid_until  DATE
   );
   CREATE UNIQUE INDEX idx_case_checks_unique ON case_checks (case_id, requirement_sequence, COALESCE(document_kind, ''));

   -- Widen the outbox for the case email (ticket 170), same move as 007.
   ALTER TABLE email_messages DROP CONSTRAINT IF EXISTS email_messages_template_check;
   ALTER TABLE email_messages ADD CONSTRAINT email_messages_template_check
       CHECK (template IN ('welcome', 'invite', 'password_reset', 'daily_digest',
                           'signup_received', 'signup_pending_admin', 'signup_approved', 'signup_rejected',
                           'case_ready'));
   ```
2. **`web/lib/case-verdict.ts`** — pure, no imports besides types:
   - `export type CheckStatus = "met" | "expiring" | "missing" | "manual"`; `export type CaseCheck = { requirement_sequence, category, title, mandatory, severity, citations, document_kind: DocumentKind | null, status, document_id: number | null, document_file_name: string | null, document_valid_until: Date | null }`.
   - `export const CHECKABLE_CATEGORIES = ["legal","fiscal_labor","economic_financial","technical"] as const`.
   - `export function normalizeText(s: string): string` — lowercase, NFD, strip `̀-ͯ`, collapse whitespace.
   - `export const KIND_RULES: { kind: DocumentKind; pattern: RegExp }[]` **in this order** (patterns run on `normalizeText(title + " " + description)`):
     1. `fgts_clearance`: `/\bfgts\b|\bcrf\b/`
     2. `labor_clearance`: `/trabalhista|\bcndt\b/`
     3. `state_tax_clearance`: `/\bestadual\b|\bestaduais\b|\bicms\b|\bdistrital\b/`
     4. `municipal_tax_clearance`: `/\bmunicipal\b|\bmunicipais\b|\bissqn?\b/`
     5. `federal_tax_clearance`: `/\bfederal\b|\bfederais\b|\buniao\b|divida ativa|\binss\b|previdenciari/`
     6. `balance_sheet`: `/balanco patrimonial|demonstracoes contabeis|indices? de liquidez|patrimonio liquido|capital (social|minimo)/`
     7. `articles_of_association`: `/contrato social|ato constitutivo|estatuto social|registro comercial|requerimento de empresario|ata de eleicao|documento de eleicao/`
     8. `cnpj_card`: `/prova de inscricao (no|do) cadastro nacional|cartao (do )?cnpj|comprovante de inscricao|inscricao no cnpj/`
     9. `technical_capacity_certificate`: `/atestado|capacidade tecnica|qualificacao tecnica|aptidao/`
   - `export function mapRequirementKinds(req: {title, description}): DocumentKind[]` — every rule that matches, rule order, deduped.
   - `export function resolveSessionAt(dates: AnalysisDate[], proposalClosesAt: Date | null): { at: Date | null; source: "dossier_session" | "dossier_proposal_deadline" | "procurement_closes_at" | null }` — first `kind === "session"` with non-null `occurs_at` (highest confidence high>medium>low, then lowest sequence), else same for `proposal_deadline`, else `proposalClosesAt`, else `{at: null, source: null}`.
   - `export function dateKey(d: Date, zoned: boolean): string` — `zoned=true` formats in `America/Sao_Paulo` (`Intl.DateTimeFormat("en-CA", {timeZone})`, used for `session_at`/today); `zoned=false` uses local getters (`valid_until` is a pg DATE parsed at local midnight).
   - `export function checkStatus(kind, documents: DocumentRow[], sessionAt: Date | null, today: Date): { status: CheckStatus; document: DocumentRow | null }` — candidates = docs of that kind; cutoff = `dateKey(sessionAt ?? today, true)`; valid = `valid_until === null || dateKey(valid_until,false) >= cutoff`; if any valid → `met`, preferring a dated-valid doc with the latest `valid_until`, undated last; else if candidates exist → `expiring` with the latest `valid_until`; else `missing`.
   - `export function computeChecks(requirements: AnalysisRequirement[], documents: DocumentRow[], sessionAt: Date | null, today: Date): CaseCheck[]` — for each requirement (ascending sequence): category not in `CHECKABLE_CATEGORIES` or zero kinds → one `manual` line (`document_kind: null`); else one line per kind via `checkStatus`.
   - `export function summarizeChecks(checks): { met; expiring; missing; manual }`.
3. **`web/lib/case-queries.ts`** — `SqlQuery` builders + async fns on `pool` (pattern: `web/lib/recommendation-queries.ts`). Tenant-scoped builders bind `company_id` as `$1`:
   - `buildListCases(companyId)` / `listCases(companyId): Promise<CaseRow[]>`; `buildGetCase(companyId, id)` / `getCase`; `buildListCaseChecks(companyId, caseId)` / `listCaseChecks` (join `cases` to scope); `buildDecideCase(companyId, caseId, userId, decision, note)` / `decideCase` → `UPDATE cases SET status='decided', decision=$4, decision_note=$5, decided_by=$3, decided_at=now(), updated_at=now() WHERE id=$2 AND company_id=$1 AND status='ready' RETURNING opportunity_id` (returns `{opportunity_id}` or null).
   - `CaseRow` = cases columns + `decided_by_name` (LEFT JOIN users) + `source_id, description, state_uf (p.state), city_name, modality_name, estimated_value, proposal_closes_at, agency_name` (`LEFT JOIN agencies a ON a.tax_id = p.agency_tax_id`, as `web/lib/opportunity-queries.ts:147`) + counts `met, expiring, missing, manual` (correlated counts over `case_checks`). BIGINTs → `Number`. Order: `(status = 'decided'), session_at NULLS LAST, id DESC`.
   - Batch (global): `listGoOpportunitiesWithoutCase(companyId?: number)`:
     ```sql
     SELECT o.id AS opportunity_id, o.company_id, o.procurement_id, r.id AS recommendation_id
       FROM opportunities o
       JOIN LATERAL (SELECT id, verdict FROM recommendations WHERE opportunity_id = o.id ORDER BY created_at DESC, id DESC LIMIT 1) r ON true
       JOIN procurements p ON p.id = o.procurement_id
      WHERE r.verdict = 'go' AND o.state <> 'dismissed'
        AND (p.proposal_closes_at >= now() OR p.proposal_opens_at > now())
        AND NOT EXISTS (SELECT 1 FROM cases c WHERE c.opportunity_id = o.id)
        AND ($1::bigint IS NULL OR o.company_id = $1)
      ORDER BY o.company_id, o.id
     ```
     `insertCase({companyId, procurementId, opportunityId, recommendationId})` (`ON CONFLICT (opportunity_id) DO NOTHING RETURNING id`); `listCasesWaitingAnalysis(companyId?)` → `{id, company_id, procurement_id}`; `getProcurementClosesAt(procurementId)`; `getCompanyAdminUserId(companyId)` (`role='admin' ORDER BY id LIMIT 1`, null if none); `replaceCaseChecks(caseId, checks, meta: {analysisVersion, sessionAt, sessionSource})` — one transaction (`pool.connect()`, BEGIN … COMMIT, ROLLBACK on error): `DELETE FROM case_checks WHERE case_id=$1`, bulk `INSERT` (citations as `JSON.stringify` + `::jsonb`), `UPDATE cases SET status='ready', analysis_version, session_at, session_source, updated_at=now()`.
4. **`web/lib/case-batch.ts`** — `export async function runCaseBatch(opts: {companyId?: number} = {}): Promise<CaseBatchResult>` with counters `{runId, created, ready, waiting, emailed, resultsRequested, resolved, failed}` (`emailed`/`resultsRequested`/`resolved` stay 0 here; tickets 170/172 fill them). Steps, each row wrapped in try/catch that increments `failed` and `console.error`s: (1) create a case per `listGoOpportunitiesWithoutCase`; (2) for every `listCasesWaitingAnalysis` row (includes the ones just created): `fetchAnalysis` → if null, `getCompanyAdminUserId` + `enqueueAnalysis` (ignore its result), `waiting++`; else `resolveSessionAt(analysis.dates, await getProcurementClosesAt(...))`, `computeChecks(analysis.requirements, await listDocuments(companyId), at, new Date())`, `replaceCaseChecks(...)`, `ready++`. `finishRun(runId, "done", counters)`; on a step-level throw `finishRun(runId, "failed", counters, message)` and rethrow.
5. **Route** `web/app/api/internal/cases/run/route.ts`: copy `recommend/run/route.ts` (body `{companyId?}` only, `maxDuration = 300`, error copy `"falha ao rodar os casos"`). Test: copy `web/app/api/internal/email/digest/route.test.ts` (401 without token; 200 with counters; 500 when the batch throws).
6. **CLI**: `src/lixto/cli/cases.py` (`name = "cases"`, `app = typer.Typer(help="Case agent commands")`, `run` with `--company-id`; prints `runId`, `created`, `ready`, `waiting`, `emailed`, `resultsRequested`, `resolved`, `failed`); `InternalApi.cases_run(*, company_id=None)` → `POST /api/internal/cases/run` (document it in the module docstring contract list). Tests: `tests/test_cli_cases.py` (stub pattern of `tests/test_cli_match_recommend.py`: happy path, `--company-id 7` forwarded, `InternalApiError` → exit 1 with `error:`), one `test_cases_run_posts_path_and_body` in `tests/test_internal_api.py`.
7. **`scripts/dev/case-fixture.sql`** (new dir; header comment `-- Dev-only fixture (cycle 30). Idempotent. Never run against prod.`):
   ```sql
   \set ON_ERROR_STOP on
   BEGIN;
   CREATE TEMP TABLE fx AS
     SELECT p.id AS procurement_id FROM procurements p
      WHERE EXISTS (SELECT 1 FROM procurement_items i WHERE i.procurement_id = p.id)
      ORDER BY p.id LIMIT 1;
   UPDATE procurements SET proposal_opens_at = now() - interval '1 day', proposal_closes_at = now() + interval '7 days', updated_at = now()
    WHERE id = (SELECT procurement_id FROM fx);
   INSERT INTO tender_analyses (procurement_id, status, schema_version, input_kind, data, executive_summary)
   SELECT procurement_id, 'done', '2.0', 'text', '{}'::jsonb, 'Fixture do agente de casos' FROM fx
   ON CONFLICT (procurement_id) DO UPDATE SET status = 'done', error = NULL, updated_at = now();
   INSERT INTO tender_analysis_requirements (procurement_id, sequence, category, title, description, mandatory, severity, statement_kind, confidence, citations)
   SELECT procurement_id, s.sequence, s.category, s.title, s.description, true, s.severity, 'fact', 'high', '[{"sequence":1,"page":12}]'::jsonb
     FROM fx, (VALUES
       (1, 'fiscal_labor', 'Regularidade com o FGTS', 'Certificado de Regularidade do FGTS (CRF) dentro da validade.', 'high'),
       (2, 'fiscal_labor', 'Certidão Negativa de Débitos Trabalhistas', 'CNDT emitida pelo TST, dentro da validade.', 'high'),
       (3, 'technical', 'Atestado de capacidade técnica', 'Atestado emitido por pessoa jurídica de direito público ou privado comprovando fornecimento compatível.', 'critical'),
       (4, 'participation', 'Vedação a consórcio', 'Não será admitida a participação de empresas em consórcio.', 'medium')
     ) AS s(sequence, category, title, description, severity)
   ON CONFLICT (procurement_id, sequence) DO NOTHING;
   INSERT INTO tender_analysis_dates (procurement_id, sequence, kind, label, occurs_at, raw_text, confidence, citations)
   SELECT procurement_id, 1, 'session', 'Sessão pública', now() + interval '7 days', 'Sessão pública em 7 dias (fixture)', 'high', '[]'::jsonb FROM fx
   ON CONFLICT (procurement_id, sequence) DO NOTHING;
   INSERT INTO opportunities (company_id, procurement_id, state)
   SELECT 1, procurement_id, 'recommended' FROM fx
   ON CONFLICT (company_id, procurement_id) DO UPDATE SET state = 'recommended', updated_at = now();
   INSERT INTO recommendations (opportunity_id, verdict, rationale, model, confidence)
   SELECT o.id, 'go', 'Fixture: vale a pena participar.', 'fixture', 0.9
     FROM opportunities o JOIN fx ON fx.procurement_id = o.procurement_id
    WHERE o.company_id = 1
      AND NOT EXISTS (SELECT 1 FROM recommendations r WHERE r.opportunity_id = o.id AND r.model = 'fixture');
   INSERT INTO company_documents (company_id, kind, file_name, storage_path, mime_type, size_bytes, valid_until, uploaded_by)
   SELECT 1, 'fgts_clearance', 'crf-fgts.pdf', 'fixtures/crf-fgts.pdf', 'application/pdf', 17, current_date + 30, 1
    WHERE NOT EXISTS (SELECT 1 FROM company_documents d WHERE d.company_id = 1 AND d.storage_path = 'fixtures/crf-fgts.pdf');
   COMMIT;
   ```
   Expected verdict: FGTS `met`, CNDT `missing`, atestado `missing`, consórcio `manual`.
8. **`web/lib/tenant-isolation.test.ts`**: register `buildListCases`, `buildGetCase`, `buildListCaseChecks`, `buildDecideCase` (each binds `COMPANY_ID` as `$1`).

Unit tests (core logic): `case-verdict.test.ts` — `normalizeText` strips accents; `mapRequirementKinds`: "Certificado de Regularidade do FGTS (CRF)" → `[fgts_clearance]`; "Certidão Negativa de Débitos Trabalhistas (CNDT)" → `[labor_clearance]`; "Prova de regularidade com a Fazenda Federal, Estadual e Municipal" → `[state_tax_clearance, municipal_tax_clearance, federal_tax_clearance]`; "Certidão negativa de falência" → `[]`; "Atestado de capacidade técnica" → `[technical_capacity_certificate]`; `computeChecks`: category `specification` → `manual` even with matching text; checkable category with no rule → `manual`; `checkStatus`: dated-valid preferred over undated; `valid_until` before session → `expiring`; no doc → `missing`; `sessionAt=null` compares against `today`; `resolveSessionAt` precedence and null `occurs_at` skipping; `summarizeChecks`. `case-queries.test.ts` — builders bind values in order; the GO query text contains `verdict = 'go'` and `NOT EXISTS`. `case-batch.test.ts` — mock `./db`, `./analysis-queries`, `./document-queries`, `./case-queries`: dossier present → `replaceCaseChecks` called, `ready` counted; dossier absent → `enqueueAnalysis` called with the admin id, `waiting` counted, `{error}` does not throw; a throwing row increments `failed` and the run still finishes `done`.

Runtime probe preconditions: dev DB `docker compose up -d db` (container `plataforma-licitante-db-1`, port 5433), dev server on :3000 (`cd web && npm run dev` in the background if `curl -s localhost:3000/login` fails). `web/.env.local` already holds `LIXTO_INTERNAL_TOKEN`; the Next dev server reads it. Company 1 / user 1 (admin) exist.

## Checks (run in order — cheapest first)
1. `cd web && npm run lint`
2. `cd web && npx vitest run lib/case-verdict.test.ts lib/case-queries.test.ts lib/case-batch.test.ts lib/tenant-isolation.test.ts app/api/internal/cases/run/route.test.ts`
3. `cd web && npx tsc --noEmit`
4. `cd web && npm test`
5. `cd web && npm run build`
6. `uv run ruff check src tests`
7. `uv run pytest -q tests/test_cli_cases.py tests/test_internal_api.py tests/test_cli_discovery.py tests/test_db.py`
8. `uv run pytest -q`
9. `LIXTO_DATABASE_URL=postgresql://lixto:lixto@localhost:5433/lixto uv run lixto db init && docker exec plataforma-licitante-db-1 psql -U lixto -d lixto -At -c "select count(*) from schema_migrations where filename = '008_cases.sql'" | grep -qx 1`
10. `docker exec -i plataforma-licitante-db-1 psql -U lixto -d lixto -q < scripts/dev/case-fixture.sql && tok=$(grep -E '^LIXTO_INTERNAL_TOKEN=' web/.env.local | cut -d= -f2- | tr -d '"') && curl -s -X POST -H "x-lixto-internal-token: $tok" localhost:3000/api/internal/cases/run | grep -q '"runId"'`
11. `docker exec plataforma-licitante-db-1 psql -U lixto -d lixto -At -c "select c.status || ':' || string_agg(k.status || '=' || k.n, ',' order by k.status) from cases c join (select case_id, status, count(*) n from case_checks group by 1, 2) k on k.case_id = c.id where c.company_id = 1 group by c.id, c.status order by c.id desc limit 1" | grep -qx 'ready:manual=1,met=1,missing=2'`
12. `tok=$(grep -E '^LIXTO_INTERNAL_TOKEN=' web/.env.local | cut -d= -f2- | tr -d '"') && curl -s -X POST -H "x-lixto-internal-token: $tok" localhost:3000/api/internal/cases/run | grep -q '"created":0'`
13. `export $(grep -E '^LIXTO_INTERNAL_TOKEN=' web/.env.local | tr -d '"') && uv run lixto cases run | grep -q '^runId:'`

## Done when
- All thirteen checks green: migration applied, fixture GO recommendation becomes a `ready` case with the four expected check lines, a second run creates nothing, and the CLI trigger prints counters.

## Not included
- Case pages, decision, sidebar (169); the `case_ready` email (170); the document bundle (171); results request and outcome (172); docs and schedules (173).
- Any change to `recommend.ts`, the match engine, the dossier worker, or `opportunities.state`.
- OCR or fact extraction from uploaded documents; Tier-0 participation gates (rendered from match reasons in 169).
