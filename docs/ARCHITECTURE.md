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
[enrich.run] Global LLM enrichment (one per open procurement)
  ↓
procurement_enrichments + procurement_categories + procurement_cnaes + procurement_requirements
  ↓
[enrich.embed] Vector embeddings (semantic search)
  ↓
procurement_embeddings (pgvector, 1536 dims)
  ↓
[match-engine] On-demand: company profile × procurement → score + reasons
  ↓
[tools] Safe structured search: search_procurements, search_my_matches, get_procurement, calculate_match, analyze_procurement
  ↓
[chat] Conversational agent (LLM orchestrates tools, no direct SQL)
```

## LLM Strategy

**Principle**: Route by task complexity, not cost alone. Primary provider (Gemini) with per-call fallback (OpenAI).

| Tier | Primary | Fallback | Purpose | Input |
|---|---|---|---|---|
| Cheap | `gemini-3.5-flash-lite` | `gpt-5-mini` | Text classification, keywords, categories | Clean text, structured metadata |
| Doc | `gemini-3.7-flash` | `gpt-5-mini` | PDF analysis (inline file parts) | Scanned PDFs, complex layouts |
| Strong | `gemini-3.7-flash` | `gpt-5.1` | Deep reasoning (reserved) | Full context for complex analysis |
| Embed | `gemini-embedding-001` | none | Embeddings (1536-dim vectors, pinned) | Concatenated enrichment text |

**Provider configuration**:
- **Primary**: `LIXTO_LLM_BASE_URL` (default: Gemini's OpenAI-compatible endpoint) + `LIXTO_LLM_API_KEY` (Gemini key)
- **Fallback**: `LIXTO_LLM_FALLBACK_BASE_URL` (default: OpenAI) + `LIXTO_LLM_FALLBACK_API_KEY` (OpenAI key) + `LIXTO_LLM_FALLBACK_MODEL_*` tier models
- **Embeddings never fall back**: all vectors must come from the same model; changing `LIXTO_LLM_MODEL_EMBED` after ingestion requires full re-embedding

**PDF handling**: Doc tier uses chat completions with inline base64 `file` content parts (not OpenAI Responses API).

**Routing logic** (`src/lixto/enrich/worker.py`):
1. If the procurement has no edital text (structured metadata only) → cheap tier.
2. If text extraction succeeded → cheap tier.
3. If text extraction failed (scanned PDF) → doc tier with PDF files.
4. On tier failure, retry once with fallback provider if configured.

Provider is abstracted (`LIXTO_LLM_BASE_URL`, OpenAI-compatible interface); switching providers is an env change.

## Cost Fence

Production ingestion is cost-fenced to keep enrichment spend within bounds.

**Ingestion stays unfenced**: `lixto sync incremental` fetches all portals, modalities, and statuses via PNCP's `/atualizacao` (HTTP only, no LLM cost).

**Details + enrichment are fenced**: Details fetch and enrichment only process procurements matching all three criteria:
- `origin_system` in `LIXTO_FENCE_PORTALS` (top-3 portals by default: Compras.gov.br, ECustomize, IPM)
- `modality_id` in `LIXTO_FENCE_MODALITIES` (modalities 6 and 8: Pregão eletrônico, Dispensa)
- `LIXTO_FENCE_OPEN_ONLY=1` restricts to open/upcoming (`proposal_closes_at >= now() OR proposal_opens_at > now()`)

**Hard daily cap**: `LIXTO_ENRICH_DAILY_CAP` limits enrichment rows written per day across all runs. When reached, `lixto enrich run` stops and says so. Every LLM call records prompt/completion tokens and estimated USD in `agent_runs.counters`.

**Cost reporting**: `lixto status` shows today's enriched/cap/tokens/estimated USD and last 7 days' total USD (integrates `agent_runs` counters).

**Configuration**: All limits are env config, not code — flip them to widen/narrow the fence without a deploy.

## Match Engine (Deterministic Scoring)

**Located**: `web/lib/match-engine.ts`

**Principle**: Company profile × procurement enrichment → 0–100 score + machine-readable reasons. No LLM at scoring time. Reasons are used by chat to explain results.

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

Structured filters (UF, modalidade, faixa de valor, situação) apply as hard `WHERE` clauses on both branches. Results are ranked via reciprocal-rank fusion (k=60 damping constant) — deterministic, no LLM. If embedding the query fails (missing key, provider error), search falls back to keyword-only. Facet counts remain keyword-only to avoid duplicate rows per filter. Each row carries `match_kind` ('keyword', 'semantic', or 'both') so the chat and UI can explain why it surfaced ("encontrei por similaridade" for semantic-only hits).

## Tools (Safe, Structured)

Located: `web/lib/agent/tools.ts`. Model calls tools by name + JSON args; every tool validates and calls a query builder (no LLM-generated SQL).

| Tool | Args | Returns | Purpose |
|---|---|---|---|
| `search_procurements` | `q`, `states`, `statuses`, `modalityIds`, `valueMin`, `valueMax`, `limit` | Procurement refs (top 20) + `match_kind` | Unauthenticated: hybrid search (keyword ∪ semantic) |
| `search_my_matches` | Same as above | Procurement refs + scores + reasons | Authenticated: procurements scored for this company |
| `get_procurement` | `sourceId` (PNCP control number) | Full dossier (detail + items + documents + enrichment) | Fetch one procurement with context |
| `calculate_match` | `sourceIds` (array, max 10) | Scores for each | Score multiple procurements for this company |
| `analyze_procurement` | `sourceId` | Dossier + cached enrichment analysis | Detail view (same as `get_procurement`) |

**Argument validation**: Unknown fields dropped, invalid types coerced or defaulted. Errors logged server-side, short PT-BR message to user.

**Response capping**: Text truncated to 160 chars, items to 20, documents to 10. Every field is billed as prompt tokens on the next turn.

**Context**: Company ID comes from session only; tools are branded for the logged-in company.

## Agent Core Tables

Written by different cycles; in cycle 19:

| Table | Columns | Cycle | Purpose |
|---|---|---|---|
| `agent_runs` | id, kind, status, started_at, finished_at, counters, error | 18 | Every CLI/sync/enrich/chat run |
| `conversations` | id, company_id, user_id, title, created_at, updated_at | 18 | Chat threads |
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
- **`/lixto`**: Chat interface opens with a system-authored message summarizing the last run
  - Counts: new/matched/attention opportunities
  - Cards for "attention" items (score ≥ 70) with score, reasons, recommendation verdict (if present)
- **`/dashboard`**: "Oportunidades de hoje" card linking to the opportunity list
- **`/opportunities`**: List company's opportunities by state/score; filter by state (matched/analyzed/dismissed)

### 4. Feedback Capture
- **User actions**: Each opportunity card offers "Tenho interesse" (accepted) and "Descartar" (dismissed with reason)
- **Reasons for dismissal**: fora do ramo / valor / prazo / exigência / outro
- **Effect**: Writes `opportunity_feedback` row + moves `opportunities.state` to `analyzed` or `dismissed`
- **Visibility**: Dismissed opportunities hidden from digest; chat tools (`list_opportunities`, `explain_opportunity`) expose same data
- **Single scoring**: Match engine used by both batch and conversational (no duplication)

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
- **Prepare/Execute**: human-approved submission artifacts (cycle 19+)
- **Learning loop**: feedback capture, outcome tracking (cycle 19+)
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
