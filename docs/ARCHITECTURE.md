# Lixto Architecture

Lixto is an AI agent for public procurement. This document describes the system as built (cycle 18).

## Pipeline Overview

```
PNCP API
  ↓
[sync] Watermarked incremental fetch (procurements, items, documents, results, plans, contracts)
  ↓
source_payloads (raw JSON retention for reprocessing)
  ↓
[sync.details] Fetch missing items/documents/amendments
  ↓
procurement_documents → [deterministic PDF extraction]
  ↓
[analyze.run] Global LLM analysis (one per open procurement: dossier + enrichment facets)
  ↓
tender_analyses + procurement_enrichments + procurement_categories + procurement_cnaes + procurement_requirements
  ↓
[enrich.embed] Vector embeddings (semantic search): enrichment text for analysed tenders;
              raw PNCP object + item text for open/upcoming tenders not analysed yet
              (runs right after each sync; a later analysis overwrites the raw vector)
  ↓
procurement_embeddings (pgvector, 1536 dims)
  ↓
[match-engine] On-demand: company profile × procurement → score + reasons
```

## LLM Strategy

**Principle**: Route by task complexity, not cost alone. Primary provider (Gemini) with per-call fallback (OpenAI).

| Tier | Primary | Fallback | Purpose | Input |
|---|---|---|---|---|
| Cheap | `gemini-3.5-flash-lite` | `gpt-5-mini` | Text classification, keywords, categories | Clean text, structured metadata |
| Doc | `gemini-3.7-flash` | `gpt-5-mini` | Tender analysis (inline file parts) | Scanned PDFs, complex layouts, page-tagged text |
| Strong | `gemini-3.7-flash` | `gpt-5.1` | Deep reasoning (reserved) | Full context for complex analysis |
| Embed | `gemini-embedding-001` | none | Embeddings (1536-dim vectors, pinned) | Concatenated enrichment text |

**Provider configuration**:
- **Primary**: `LIXTO_LLM_BASE_URL` (default: Gemini's OpenAI-compatible endpoint) + `LIXTO_LLM_API_KEY` (Gemini key)
- **Fallback**: `LIXTO_LLM_FALLBACK_BASE_URL` (default: OpenAI) + `LIXTO_LLM_FALLBACK_API_KEY` (OpenAI key) + `LIXTO_LLM_FALLBACK_MODEL_*` tier models
- **Embeddings never fall back**: all vectors must come from the same model; changing `LIXTO_LLM_MODEL_EMBED` after ingestion requires full re-embedding

**PDF handling**: Doc tier uses chat completions with inline base64 `file` content parts (not OpenAI Responses API).

**Routing logic** (`src/lixto/analyze/worker.py`):
1. If the procurement has extracted page text → doc tier on page-tagged text of every PDF.
2. If text extraction failed but PDFs are available (≤ max_pdfs) → doc tier with PDF files (inline base64).
3. If no documents or extraction impossible → cheap tier on PNCP metadata only.
4. On tier failure, retry once with fallback provider if configured.

Provider is abstracted (`LIXTO_LLM_BASE_URL`, OpenAI-compatible interface); switching providers is an env change.

## Cost Fence

Production ingestion is cost-fenced to keep enrichment spend within bounds.

**Ingestion stays unfenced**: `lixto sync incremental` fetches all portals, modalities, and statuses via PNCP's `/atualizacao` (HTTP only, no LLM cost).

**Details + analysis are fenced**: Details fetch and `lixto analyze run` only process procurements matching all three criteria:
- `origin_system` in `LIXTO_FENCE_PORTALS` (top-3 portals by default: Compras.gov.br, ECustomize, IPM)
- `modality_id` in `LIXTO_FENCE_MODALITIES` (modalities 6 and 8: Pregão eletrônico, Dispensa)
- `LIXTO_FENCE_OPEN_ONLY=1` restricts to open/upcoming (`proposal_closes_at >= now() OR proposal_opens_at > now()`)

**Hard daily cap (cron)**: `LIXTO_ENRICH_DAILY_CAP` limits analyses written per day by `lixto analyze run` across all runs. When reached, the cron stops and says so. Every LLM call records prompt/completion tokens and estimated USD in `agent_runs.counters`.

**On-demand jobs bypass the fence** but are **capped per company** by `LIXTO_ANALYZE_USER_DAILY_CAP` (default 10). The "Analisar com IA" button on any open procurement without a dossier enqueues a job (`analysis_jobs` row); web polls for completion. Re-run only when the document set hash changes (`version` increments).

**Cost reporting**: `lixto status` shows today's enriched/cap/tokens/estimated USD and last 7 days' total USD (integrates `agent_runs` counters).

**Configuration**: All limits are env config, not code — flip them to widen/narrow the fence without a deploy.

## Match Engine (Deterministic Scoring)

**Located**: `web/lib/match-engine.ts`

**Principle**: Company profile × procurement enrichment → 0–100 score + machine-readable reasons. No LLM at scoring time. Reasons are shown in the opportunities UI to explain results.

### Scoring Rules

| Reason Code | Condition | Weight | Details |
|---|---|---|---|
| `cnae_primary` | CNAE in enrichment matches company's primary CNAE | +20 | Direct industry match |
| `cnae_secondary` | CNAE in enrichment matches any secondary CNAE | +10 | Secondary alignment |
| `term_enrichment` | Company terms overlap with enrichment keywords/concepts | +15 | Keyword/concept hit |
| `term_text` | Company terms found in procurement description/items (FTS) | +10 | Text search match |
| `state_ok` | Procurement's state in company's allowed states (empty = all) | +5 | Geography match |
| `state_out` | Procurement's state NOT in company's allowed states | -30 | Geography mismatch |
| `value_ok` | Estimated value in company's min/max range | +5 | Budget fit |
| `value_out` | Estimated value outside range | -30 | Budget mismatch |
| `value_unknown` | No estimated value in procurement | -5 | Data gap |
| `me_epp_exclusive` | Procurement reserved to ME/EPP; company qualifies (MEI/ME/EPP) | +25 | Regulatory advantage |
| `me_epp_exclusive` | Procurement reserved to ME/EPP; company does NOT qualify | -40 | Disqualifying |
| `requires_certification` | Procurement requires cert; company claims to have it (via document upload) | +10 | Qualification ready |
| `requires_technical_certificate` | Procurement requires technical cert; company has it | +15 | Technical readiness |
| `exclusion` | Company's exclusion terms found in procurement (FTS) | -50 | Explicit disqualification |
| `semantic_high` | Cosine similarity (profile embedding vs procurement embedding) >= 0.75 | +20 | Strong semantic match |
| `semantic` | Cosine similarity 0.5–0.75 | +5 | Semantic signal |
| `no_profile` | Company has no profile (terms, CNAEs, states) and no document uploads | -25 | Profile incomplete |

**Clamping**: Final score clamped to 0–100 (reason weights are raw and sum to >100 to allow weight visibility at score 0).

**Profile data** (`companies`, `company_profiles`, `company_cnaes`, `company_documents`):
- `company_profiles.terms` — normalized(products ∪ keywords)
- `company_profiles.exclusion_terms` — normalized(exclusions)
- `company_profiles.states` — array of allowed UF codes (empty = all)
- `company_profiles.min_value`, `max_value` — NUMERIC(18,2)
- `company_profiles.embedding` — vector(1536) (from products + keywords)
- `companies.size` — MEI/ME/EPP/MEDIUM/LARGE
- `company_documents.kind` — certifications etc.

## Query-time semantic search

When a search carries free text (q parameter), the query builder embeds it via `embedQuery` and retrieves candidates from two branches:
1. **Keyword branch**: Full-text search on procurement description and items (same as keyword-only queries).
2. **Semantic branch**: Top-K vector similarity (cosine ≥ 0.4 minimum; K=200 candidates) from `procurement_embeddings`.

Structured filters (UF, modalidade, faixa de valor, situação) apply as hard `WHERE` clauses on both branches. Results are ranked via reciprocal-rank fusion (k=60 damping constant) — deterministic, no LLM. If embedding the query fails (missing key, provider error), search falls back to keyword-only. Facet counts remain keyword-only to avoid duplicate rows per filter. Each row carries `match_kind` ('keyword', 'semantic', or 'both') so the UI can explain why it surfaced ("encontrei por similaridade" for semantic-only hits).

## Agent Core Tables

Written by different cycles; in cycle 19:

| Table | Columns | Cycle | Purpose |
|---|---|---|---|
| `agent_runs` | id, kind, status, started_at, finished_at, counters, error | 18 | Every CLI/sync/enrich run |
| `conversations` | id, company_id, user_id, title, created_at, updated_at | 18 | Chat threads (schema kept; chat UI removed in cycle 23, no new rows) |
| `messages` | id, conversation_id, role, content, tool_calls, tool_call_id, refs, model, created_at | 18 | Messages in a thread |
| `opportunities` | id, company_id, procurement_id, state, score, reasons, attention, computed_at | 19 | Per-company × procurement lifecycle; state ∈ discovered/matched/analyzed/recommended/preparing/awaiting_approval/executed/dismissed |
| `matches` | id, company_id, procurement_id, score, reasons, engine_version, computed_at | 19 | Persisted match history (for proactive mode, learning loop) |
| `recommendations` | id, opportunity_id, verdict, rationale, model, confidence, created_at | 19 | GO/NO-GO verdicts (verdict ∈ go/no_go/borderline) |
| `agent_actions` | id, run_id, opportunity_id, kind, status, approved_by, executed_at, result | Placeholder | Prepare/execute with approval (cycle 19+) |
| `opportunity_feedback` | id, opportunity_id, user_id, kind, reason, price, margin_pct, created_at | 19 | Feedback capture: accepted/rejected/participated/won/lost/disqualified |

In cycles 18–19, `agent_runs`, `conversations`, `messages`, `opportunities`, `matches`, `recommendations`, `opportunity_feedback` are written by CLI/web. `agent_actions` remains placeholder for cycle 19+.

## Proactive Loop (Cycle 19)

Every newly enriched procurement is automatically evaluated against every company profile and surfaced as opportunities. The loop consists of:

### 1. Batch Match (`lixto match run`)
- **Endpoint**: `POST /api/internal/match/run` (web; triggered by CLI with shared secret `LIXTO_INTERNAL_TOKEN`)
- **Process**: For each company with a profile or CNAEs, score procurements enriched since the last run with the same deterministic scoring rule used in chat
- **Output**: Persist a `matches` row (history), upsert an `opportunities` row (lifecycle)
- **Thresholds**:
  - Score ≥ 70 → `opportunities.state='matched'` + `attention=true` (deserves attention)
  - 40–69 → `matched`, `attention=false`
  - Below 40 → no row created
- **Idempotency**: One match per company × procurement × engine version; reruns are safe
- **Schedule** (Dokploy, disabled by default): `0 8,15,22 * * *` (runs after enrichment completes)

### 2. Recommendations (`lixto recommend run`)
- **Endpoint**: `POST /api/internal/recommend/run` (web; triggered by CLI)
- **Process**: For each company, select the top 5 new opportunities (score ≥ 70) created today
- **Output**: Create a `recommendations` row per opportunity with verdict (go/no_go/borderline) + Portuguese rationale + confidence
- **Analysis**: Uses enrichment data (requirements, risks, delivery), company profile (CNAEs, terms), and uploaded habilitação documents
- **LLM Model**: Tier-3 (`LIXTO_RECOMMEND_MODEL`, default `gpt-5.1`)
- **Hard cap**: 5 recommendations per company per day (server-enforced)
- **Failures**: Never block the digest; logged in `agent_runs`
- **Schedule** (Dokploy, disabled by default): `15 8 * * *` (after match-run)

### 3. In-App Digest
- **`/dashboard`**: "Oportunidades de hoje" card shows counts (new/matched/attention opportunities) and links to the opportunity list
- **`/opportunities`**: List company's opportunities by state/score; filter by state (matched/analyzed/dismissed); cards display score, reasons, and recommendation verdict (if present) for "attention" items (score ≥ 70)

### 4. Feedback Capture
- **User actions**: Each opportunity card offers "Tenho interesse" (accepted) and "Descartar" (dismissed with reason)
- **Reasons for dismissal**: fora do ramo / valor / prazo / exigência / outro
- **Effect**: Writes `opportunity_feedback` row + moves `opportunities.state` to `analyzed` or `dismissed`
- **Visibility**: Dismissed opportunities hidden from digest; chat tools (`list_opportunities`, `explain_opportunity`) expose same data
- **Single scoring**: Match engine used by both batch and conversational (no duplication)

## Future Procurement Radar (Cycle 24)

Proactive surface of planned public purchases (PCA items) before the tender is published. One opportunity = one PCA item.

### Pipeline

```
lixto plans sync (watermarked, incremental)
  ↓
procurement_plans + procurement_plan_items
  ↓
lixto plans embed (backfill embeddings for in-horizon items)
  ↓
plan_item_embeddings (pgvector, 1536 dims)
  ↓
lixto radar run (detect → score opportunity → expire stale → per-company match)
  ↓
future_opportunities (detected, scored once globally)
  ↓
future_opportunity_matches (per-company relevance, scored per profile)
  ↓
/radar UI (list, filter by state/period/value/min score, detail view with analysis)
```

### Opportunity Scoring

**Two separate scores** (PRODUCT.md):

1. **Opportunity score** (0–100, "will it happen?"): Pure PCA data (item existence, date proximity, plan recency). No LLM.
   - Base `pca_item` weight (default 50): item exists in a published plan
   - `date_near` (0–90 days ahead; default weight 30)
   - `date_mid` (90–180 days ahead; default weight 15)
   - `recent_plan_update` (within 60 days; default weight 20)
   - Weights from `LIXTO_RADAR_WEIGHT_*` env vars; final score clamped 0–100

2. **Company match score** (0–100, "does it fit?"): Deterministic profile × item signals. No LLM per item.
   - Profile `terms` FTS on item title
   - Profile exclusion terms (negative)
   - Profile `states` vs agency state
   - Profile value band (min/max) vs estimated value
   - Cosine similarity (profile embedding vs plan-item embedding, same model as procurements)
   - Minimum 40 to persist in `future_opportunity_matches`

**Deterministic "why"**: Signals always rendered from structured list (code + weight + detail). No LLM guessing.

**On-demand AI**: "Analyze with AI" calls LLM once per opportunity×company (why it may happen, compatibility, preparation steps), cached in `future_opportunity_analyses`. Zero LLM spend for unopened items. Rate-limited: `LIXTO_RADAR_ANALYSIS_DAILY_CAP` (default 20) per company per day. Model: `LIXTO_RADAR_ANALYSIS_MODEL` (falls back to `LIXTO_RECOMMEND_MODEL`, then `gpt-5.1`).

### Horizon

Items included in the Radar are those whose desired date is on or after today and no later than `LIXTO_RADAR_HORIZON_DAYS` ahead (default 365). Items past their desired date or removed from the plan are marked `status = 'expired'` and hidden from the list. `detected_at` is never rewritten — it is the evidence that Lixto saw this purchase before the tender existed.

### UI & Routes

- **`/radar`**: List opportunities, filter by state (predicted/expired), period (1m/3m/6m/1y), value band, min score. Cards show title, agency, estimated value, desired date, opportunity score + top signals, company match score (for logged-in user's company).
- **`/radar/[id]`**: Detail view. Agency, PCA item, value, quantity, date, PDM code/classification. Opportunity signals and company match reasons. "Analyze with AI" button + cached analysis. Save / ignore action.

### Status Lifecycle

- `predicted`: Detected in horizon (initial state)
- `procurement_found`: V2 linker found the corresponding tender (procurement exists in PNCP)
- `expired`: Desired date passed or item removed from plan

`detected_at` is immutable and serves as the ground truth for "found N days before publication" analytics.

## Transactional email

**Model**: Persisted outbox (idempotent, never lose or duplicate mail). Every send enqueued in the same transaction as the business event; worker drains queue with bounded retries and exponential backoff.

### Outbox

`email_messages` table:
- `id`, `to_email`, `template`, `payload JSONB`, `subject`, `status` (queued|sending|sent|failed|suppressed), `attempts`, `last_error`, `provider_message_id`, `scheduled_for`, `sent_at`, `created_at`, `updated_at`
- Unique index on `(to_email, template, dedupe_key)` for idempotency

`email_suppressions` table:
- `address`, `reason` (bounce|unsubscribe), `created_at`
- Suppress future sends to hard-bounce addresses and digest unsubscribes

### Templates

| Template | Use | Unsubscribable |
|---|---|---|
| `welcome` | Account created | No (transactional) |
| `invite` | User invite (existing token) | No (transactional) |
| `password_reset` | Password reset (short-lived token) | No (transactional) |
| `daily_digest` | New attention-scoring opportunities | Yes (footer link) |

### Dispatch

- **`lixto email worker`** (Dokploy schedule every 5 min): Drain `email_messages` with status=queued up to `--limit` (default 20). Send via SMTP, mark status=sent/failed/suppressed. Only *synchronous* rejections (the local SMTP handshake) are classified here.
- **`lixto email bounces`** (Dokploy schedule every 5 min, offset from the worker): Ingest the MTA's DSN maildir (`LIXTO_BOUNCE_MAILDIR`, a volume shared between `lixto-mail` and `lixto-web`). A hard (5.x.x) DSN that matches a message we sent marks that row failed and inserts a `hard_bounce` suppression; soft (4.x.x) DSNs are logged; DSNs matching nothing we sent are quarantined, never acted on (the bounce address accepts mail from anyone).
- **`lixto email digest`** (Dokploy schedule 8:30 AM): Enqueue daily digest per company after `recommend-run` completes. Digest only sends if company has new opportunities (score ≥ 70 with attention=true).

### MTA (Self-Hosted)

**Container**: Postfix + opendkim on `plugu-prod01` (Hostinger BR, 187.127.16.246).

**Configuration**:
- Submission port 25 only (internal Docker network, no TLS needed)
- Direct-to-MX delivery (verified port 25 open)
- Rate-limited below Hostinger's 5 msg/min cap
- DKIM selector configured in volume
- Bounces parsed and written to `email_suppressions`

**DNS**: Managed by Terraform (`infra/terraform/`):
- `mail.lixto.com.br` A record (grey-cloud, non-proxied)
- MX 10 mail.lixto.com.br
- SPF replacing old deny-all
- DKIM selector TXT (public half; private key in volume, never in state)
- DMARC rua=mailto:dmarc@lixto.com.br (policy=none for initial reputation building)

**PTR**: Manual (Hostinger hPanel): 187.127.16.246 → mail.lixto.com.br (required for Gmail/Outlook forward-confirmed rDNS).

**Escape hatch**: If IP reputation fails, change `relayhost` in Postfix config to point at external submission service on 587/465 (no code changes).

### Status

`lixto status` includes email block:
```
email:
  queued: <n>
  sent (24h): <n>
  failed (24h): <n>
  suppressed: <n>
```

## Enrichment Schema

`procurement_enrichments` (one per open procurement):

```json
{
  "schema_version": "1.0",
  "model": "gemini-3.5-flash-lite",
  "confidence": 0.92,
  "status": "done",  // or "error"
  "input_kind": "text",  // "structured" | "text" | "pdf"
  "summary": "Procurement for office supplies...",
  "concepts": ["office_supplies", "stationery"],
  "keywords": ["pen", "paper", "desk"],
  "categories": ["material_escritorio"],
  "risks": ["budget_uncertainty"],
  "complexity": "low",  // "low" | "medium" | "high"
  "requires_certification": false,
  "requires_technical_certificate": false,
  "delivery_location": "São Paulo, SP",
  "delivery_deadline_days": 30,
  "data": { /* full canonical payload */ }
}
```

**Tier-0 fields** (deterministic, derived from `procurement_items.benefit_type_id` at enrichment write time):
- `me_epp_exclusive` (bool) — `true` if any item has `benefit_type_id = 1` (exclusive)
- `me_epp_preference` (bool) — `true` if any item has `benefit_type_id ∈ {2, 3}` (subcontracting or reserved quota)

Facet tables link back to `procurements`:
- `procurement_categories` — normalized categories
- `procurement_requirements` — legal_qualification | tax_compliance | technical_qualification | economic_qualification | document | certification | sample | site_visit | other
- `procurement_cnaes` — cnae_code + confidence (from enrichment only; origin = 'enrichment')
- `procurement_embeddings` — pgvector cosine index (HNSW)

## Tender Analysis (Cycle 25)

One pass (`lixto analyze run`) replaces cycle 18's enrichment: processes every fenced open procurement's documents (PDF text extraction + fallback OCR) and writes both enrichment facets (schema_version 2.0) *and* a deep, cited dossier in new `tender_analyses` tables.

**Output tables** (one procurement-scoped set per analysis):
- `tender_analyses` — executive summary, object, overall risk, document set hash, version, status
- `tender_analysis_facts` — basic + commercial fields (group, key, label, value, confidence: high|medium|low) with citations `(sequence, page)`
- `tender_analysis_dates` — kinds ∈ {proposal_deadline, session, clarification_deadline, challenge_deadline, site_visit, contract_start, delivery, other}
- `tender_analysis_requirements` — category ∈ {participation, legal, fiscal_labor, economic_financial, technical, specification, guarantee, other}; mandatory flag; severity ∈ {low, medium, high, critical}
- `tender_analysis_penalties` — description + basis
- `tender_analysis_risks` — kind ∈ {risk, red_flag, contradiction, amendment}; severity; title + description + recommendation
- `tender_analysis_missing` — field + note for data gaps

**Workflow**:
1. Cron `lixto analyze run` selects fenced procurements without a complete analysis, fetches all active PDFs, extracts text (per-page to `procurement_document_pages`), routes to LLM by input kind (text/PDF/structured), validates output schema, writes dossier + enrichment in one transaction.
2. Web button "Analisar com IA" on any open procurement enqueues `analysis_jobs` row (company-scoped, queued), capped per company by `LIXTO_ANALYZE_USER_DAILY_CAP` (default 10).
3. Cron `lixto analyze jobs` drains queued jobs, same worker, bypasses fence but respects per-company cap.

**Deterministic reprocessing**: If document set hash changes (new/updated PDFs), `version` increments and the dossier is marked stale; re-run fetches the new set.

## Case agent (Cycle 30)

One GO recommendation becomes one case: a structured habilitação verdict computed in code from the dossier (tender analysis, requirements) and the company's own uploaded documents, with no LLM cost.

**Output tables** (new in `migrations/008_cases.sql`):
- `cases` — one row per company × GO procurement; status ∈ {waiting_analysis, ready, decided}; decision ∈ {submit, skip, missing_document} once operator answers; outcome ∈ {won, lost, disqualified} after PNCP results arrive
- `case_checks` — one verdict line per dossier requirement × document kind; status ∈ {met, expiring, missing, manual} (manual = unrecognizable requirement, human check required)

**Verdict rules** (pure code in `web/lib/case-verdict.ts`):
- Nine ordered regex rules map requirement text → document kind (FGTS, labor, tax, balance sheet, articles, CNPJ, technical cert)
- Four checkable categories: legal, fiscal_labor, economic_financial, technical
- Check status: *atende* (document present, valid ≥ session date), *vence antes da sessão*, *falta*, or *verificar* (no rule match)
- Session date resolved with precedence: dossier session → proposal deadline → procurement closes-at
- Check counts aggregated per case: met, expiring, missing, manual

**Batch pipeline** (`web/lib/case-batch.ts`, endpoint `POST /api/internal/cases/run`, CLI `lixto cases run`):
1. **Create**: One case per GO recommendation (score ≥70) on an open procurement
2. **Compute verdict**: For each waiting case, fetch dossier; if ready, compute checks from requirements + company's documents; if not, enqueue analysis (existing per-company cap); mark ready
3. **Email**: One `case_ready` email per admin for every case that just turned ready; stamped once, never re-sent
4. **Request results** (after `RESULTS_DELAY_DAYS = 2` past session): Open items on PNCP results demand queue (`procurement_items.results_requested_at`); cron `lixto results sync` drains queue
5. **Resolve outcome**: Check `procurement_results`; if company's tax_id is winner on any item → *ganhou*; if all items synced with no winner → *perdeu*; else keep waiting. Operator can always correct to *desclassificado* (ticket 172)

**Decision → feedback** (server action `web/app/(app)/cases/[id]/actions.ts`):
- `skip` ("Não vou") → `opportunity_feedback.kind='rejected'`, dismiss opportunity
- `submit` ("Vou enviar") → `opportunity_feedback.kind='participated'`
- `missing_document` → no feedback (human-only note)
- Outcome `won`/`lost` (from PNCP) → `opportunity_feedback.kind='won'/'lost'`
- Operator disqualification → `opportunity_feedback.kind='disqualified'`

**Constants**:
- `RESULTS_DELAY_DAYS = 2` (case-outcome.ts)
- Four check statuses: met, expiring, missing, manual
- Four checkable requirement categories: legal, fiscal_labor, economic_financial, technical

**Cost**: Zero LLM per case. The only cost is `enqueueAnalysis` if the dossier doesn't exist yet (same per-company daily cap as on-demand analysis).

## Caching (Cycle 31)

**In-process cache** (`web/lib/cache.ts`): Tags (`sync`, `match`), TTL fallback (env, default 900 s), bounded entries, single-flight on concurrent misses. **Not** Next `unstable_cache` or Redis.

**Memoised under tag `sync`**: `fetchModalityOptions`, all 5 facet queries (dashboard, procurement list), `fetchStatusCounts`, `fetchByDay`, `fetchByModality`/`fetchByPortal`. Also memoised per request (React `cache`): `getSession` (ADR 003 §D3).

**Memoised under tag `match`**: Last global match run (read by digest).

**Invalidation**: `POST /api/internal/cache/revalidate {tags?: ("sync"|"match")[]}` (default `["sync"]`) drops the tag. CLI `lixto cache revalidate [--tag …]` is the manual trigger; `lixto sync incremental` calls it automatically at the end (best-effort; never changes exit code). TTL fallback covers a sync that dies before revalidation.

**Query fixes that look like caching**: `match-queries.ts` OR-EXISTS FTS rewritten as `id IN (… UNION …)` with open/upcoming filter inside the semantic CTE; Radar FTS drops `coalesce` so the index applies; Radar upsert guarded with `IS DISTINCT FROM`. List rows and count from one statement (`count(*) OVER ()`). Profile save skips embed when `embedding_text` is unchanged.

**Not cached**: Per-company lists (opportunities, cases, radar), sessions, detail pages, search-text embeddings (in-process LRU in `embed.ts`, bounded by env; no shared cache needed).

**Pool**: `web/lib/db.ts` sets `max`, `statement_timeout`, `application_name` from env. Connection string from `LIXTO_DATABASE_URL`.

## Web app interaction model (Cycle 27)

**Loading boundaries**: Each route (`/dashboard`, `/procurements`, `/radar`, `/opportunities`, etc.) has a per-route `loading.tsx` skeleton. No root `loading.tsx`; streams begin immediately with skeleton + fast metadata, then `Suspense` boundaries paint results on arrival. Per-page `loading.tsx` + route-level Suspense sections = instant visual feedback on every navigation.

**URL state**: Three files own the URL contract:
- `lib/url-state.ts` — shared literals and parsers for pill-tab groups (`CHART_SCOPES`, `OPPORTUNITY_VIEWS`, `RADAR_VIEWS`)
- `lib/procurement-url.ts` — builds/parses `/procurements` query strings (filters, page); client-only implementation mirrored by server-side `parseFilters` in `lib/procurement-queries.ts`
- `lib/radar-url.ts` — builds/parses `/radar` query strings; mirrors server-side `parseRadarFilters`

**Filter semantics**: Filters apply on `onChange` via `useTransition` + `startTransition(router.push())` — no "Aplicar" button, no page remount. Server page re-runs instantly.

**Optimistic actions**: Dismiss/interest buttons use `useOptimistic` to animate the card out immediately; `sonner` toast offers "Desfazer" (undo) + refetch on approval. Pattern shown in `components/opportunity-feedback.tsx`.

**Keyboard + palette**: 
- `lib/keyboard-shortcuts.ts` binds `g r/p/l` (nav) and `?` (palette).
- `components/ui/command-search.tsx` (`cmdk`) opens on `?`, lists static nav + live procurement results via `paletteSearchAction`.
- Nav shortcuts hint rendered in sidebar.

**Theme**: `--color-*` tokens in `app/globals.css` @theme block. `:root` defaults to OS scheme; user toggle writes `light`/`dark` to `lixto.theme` localStorage, sets `data-theme` on `<html>`. Inline script in `app/layout.tsx` reads the key before hydration to avoid flash.

### Session-aware public pages

Public pages (`/login`, `/signup`, `/signup/recebido`) redirect logged-in visitors via two helpers: `getOptionalSession` (server-only; treats any DB outage as logged out) and `redirectIfLoggedIn` (both in `web/lib/public-pages.ts`). Redirect targets are sanitised via `safeNextPath` (`web/lib/safe-next.ts`; rejects `//`, `/\`, embedded `\r`/`\n`/`\t`, and public-only/side-effecting targets (`/login`, `/signup*`, `/logout`)). The marketing header (`web/components/marketing/header-actions.ts`) is session-aware, showing "Ir para o painel" when logged in; the footer "Entrar" link is unchanged by design (a logged-in click lands on `/dashboard` via the `/login` redirect). `web/proxy.ts` cannot make this decision (no pg pool; stale cookie would loop `/login` ↔ `/dashboard`); only validated `getSession()` calls are trusted. `/` is dynamic because it reads the cookie. `getOptionalSession` rethrows Next control-flow errors via `unstable_rethrow` before treating a failure as logged out.

## API Contracts

### PNCP Endpoints Used

1. **Incremental procurements** (`/v1/contratacoes/atualizacao`)
   - Per modality (13 types), watermarked window
   - Returns: procurement + items embedded

2. **Details** (`/v1/contratacoes/{id}`, `/v1/contratacoes/{id}/documentos`, `/v1/contratacoes/{id}/itens`)
   - Items with descriptions, quantities, unit prices
   - Documents with titles, types, URLs

3. **Results** (`/v1/contratacoes/{id}/itens/{item}/resultados`)
   - Homologated winners, unit prices, discounts

4. **Plans** (`/v1/pca/atualizacao`)
   - Annual procurement plans with items
   - Watermarked by `dataAtualizacaoGlobalPCA`
   - Note: ~200k rows / 3-day window; HTTP 200 with empty body on retries (idempotent)

5. **Contracts** (`/v1/contratos/atualizacao`)
   - Contract registry (not procurements)
   - Watermarked by `dataAtualizacaoGlobal`

6. **Amendments** (`/v1/orgaos/{cnpj}/contratos/{ano}/{seq}/termos`)
   - Contract modifications (additions, readjustments, extensions)
   - Per contract; synced on-demand when `amendments_synced_at IS NULL`

See `docs/PNCP_API.md` for DTO field mappings.

## Not Built Yet

(Vision alignment tracking; see `docs/VISION.md` Appendix for details)

- **Proactive mode**: batch match → persisted `matches` table → daily digest/notifications (cycle 19)
- **Deep analysis**: on-demand Tier-3 model analysis per procurement (model uses enrichment + company context + documents)
- **Prepare/Execute**: partial (cycle 30): case verdict, document bundle, one decision; portal submission not built
- **Learning loop**: outcome capture built (cycle 30); ranking changes not built
- **Streaming chat**: currently single JSON reply per turn
- **HTML parsing**: PNCP attaches PDFs; revisit if other portals added
- **Richer profiles**: supplier list, delivery capacity, financial constraints, preferred portals, historical participation

## Configuration

### Key Environment Variables

- `LIXTO_DATABASE_URL` — PostgreSQL connection (default: local via docker-compose)
- `LIXTO_LLM_BASE_URL`, `LIXTO_LLM_API_KEY`, `LIXTO_LLM_MODEL_*` — Primary LLM provider (see LLM Strategy section)
- `LIXTO_LLM_FALLBACK_*` — Fallback provider when primary errors (see LLM Strategy section)
- `LIXTO_FENCE_PORTALS`, `LIXTO_FENCE_MODALITIES`, `LIXTO_FENCE_OPEN_ONLY` — Cost fence scope (see Cost Fence section)
- `LIXTO_ENRICH_DAILY_CAP` — Daily enrichment row limit (see Cost Fence section)
- `LIXTO_IBGE_CNAE_URL` — CNAE seed source
- `LIXTO_MIN_REQUEST_INTERVAL` — Seconds between PNCP HTTP requests (default 0.5)
- `UPLOADS_DIR` — Document storage
- `LIXTO_WEB_CACHE_TTL_SECONDS` — In-process cache time-to-live (web only; default 900)
- `LIXTO_WEB_CACHE_MAX_ENTRIES` — In-process cache entry limit (web only; default 500)
- `LIXTO_WEB_EMBED_CACHE_SIZE` — Query embedding LRU cache size (web only; default 500)
- `LIXTO_PG_POOL_MAX` — Database pool max connections (web only; default 10)
- `LIXTO_PG_STATEMENT_TIMEOUT_MS` — Database query timeout in milliseconds (web only; default 60000)

### Database

**Engine**: PostgreSQL 16+ with pgvector extension.

**Schema**: `public` (inside database `lixto`).

**Key indexes**:
- FTS on `procurements.description`, `procurement_items.description`, `procurement_plan_items.description`, `contracts.description`
- HNSW cosine on `procurement_embeddings.embedding`
- GIN on arrays: `procurement_enrichments.keywords`, `.concepts`, `company_profiles.terms`

**Uniqueness**:
- `procurements (source, source_id)` — PNCP control number is the natural key
- `procurement_plans (source, source_id)`
- `contracts (source, source_id)`
- `cnae_codes (code)` — 7-digit IBGE subclass
- `companies (tax_id)` — CNPJ, digits only
- `users (email)` — lowercased

## Testing & Quality

**Python**: ruff (lint), pytest (core logic only per PRODUCT.md mode=production).

**TypeScript**: eslint, tsc, vitest (match engine, tools, queries).

**SQL**: migrations tested on schema init; no runtime-generated SQL.

## Scheduling

All recurring jobs run on Dokploy in production (VPS). Local dev runs `lixto` commands manually.

See `README.md` for the schedule table (cron, command, enabled status).
