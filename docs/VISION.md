# Lixto — Product & Technical Architecture (vision)

> Original vision document, ingested into forge on 2026-08-25. Kept verbatim as the
> long-term direction; see **Appendix — Implementation status** at the end for what
> is built (cycles 16–18) and what is still open. `docs/ARCHITECTURE.md` documents the
> shipped architecture; `STATE.md` tracks the current cycle.

## 1. Product vision

**Lixto** is an AI agent for public procurement. The product should move
away from the traditional procurement-platform experience centered on
large tables, keyword fields, and complex filter panels.

The primary experience is conversational:

> **"Lixto, find open bids that contain pencils as an item, in Rio de
> Janeiro, where my company is eligible to participate."**

Behind the conversation, Lixto searches structured procurement data,
analyzes notices and attachments, considers the customer's company
profile, and returns actionable results.

At the same time, Lixto operates proactively: every new procurement
opportunity ingested from public portals can be evaluated against
customer profiles and surfaced when relevant.

### Long-term product direction

The progression of autonomy should be:

1.  **Search** --- finds opportunities.
2.  **Analyze** --- interprets procurement notices and attachments.
3.  **Recommend** --- produces GO / NO-GO recommendations.
4.  **Prepare** --- prepares documents and participation artifacts.
5.  **Execute with approval** --- performs operational actions after
    human approval.
6.  **Autonomous agent** --- eventually handles routine procurement
    operations, escalating exceptions.

For the initial product, the recommended target is **semi-autonomous
operation**: Lixto does most of the work but requires human approval
before financially, legally, or operationally consequential actions.

------------------------------------------------------------------------

## 2. Existing foundation

The current system already:

-   downloads procurement data from **PNCP**;
-   persists PNCP data in a database;
-   lists procurement opportunities;
-   exposes procurement details;
-   provides access to notices and related documents.

This should be treated as the foundation rather than rebuilt.

The next version adds an intelligence layer over this existing ingestion
and storage system.

------------------------------------------------------------------------

## 3. Core architectural principle

### Process once, reuse globally

Information that depends only on a procurement opportunity should be
processed **once during ingestion**, not once per customer.

Example:

``` text
PNCP procurement
      ↓
global enrichment
      ↓
canonical structured representation
      ↓
reused by every customer
```

If 10,000 customers can potentially match the same procurement, Lixto
should not ask an LLM to analyze that procurement 10,000 times.

Customer-specific intelligence should happen later, by matching the
globally enriched procurement against each organization's profile.

------------------------------------------------------------------------

## 4. Proposed pipeline

``` text
                         PNCP
                           │
                           ▼
                ┌─────────────────────┐
                │   RAW INGESTION     │
                │ data + attachments  │
                └──────────┬──────────┘
                           │
                           ▼
                ┌─────────────────────┐
                │ DETERMINISTIC PARSE │
                │ JSON / PDF / HTML   │
                └──────────┬──────────┘
                           │
             ┌─────────────┴─────────────┐
             ▼                           ▼
     Structured PNCP data          Document content
             │                           │
             │                           ▼
             │                  Text extraction/parser
             │                           │
             │                   extraction good?
             │                     /           \
             │                   yes            no
             │                    │              │
             │                    ▼              ▼
             │             cheap text LLM   multimodal LLM
             │                    │              │
             └──────────────┬─────┴──────────────┘
                            ▼
                 ┌──────────────────────┐
                 │ GLOBAL ENRICHMENT    │
                 │ canonical JSON       │
                 └──────────┬───────────┘
                            │
                            ▼
                       PostgreSQL
                            │
                  ┌─────────┴─────────┐
                  ▼                   ▼
               pgvector          full-text /
               semantic           structured
                search              indexes
                  │                   │
                  └─────────┬─────────┘
                            ▼
                 ┌──────────────────────┐
                 │    MATCH ENGINE      │
                 │ company × opportunity│
                 └──────────┬───────────┘
                            │
                            ▼
                 ┌──────────────────────┐
                 │       LI X T O       │
                 │ conversational agent │
                 └──────────┬───────────┘
                            │
            ┌───────────────┼────────────────┐
            ▼               ▼                ▼
          Search          Analyze        Recommend /
                                         prepare /
                                          execute
```

------------------------------------------------------------------------

## 5. Ingestion stages

### 5.1 Raw ingestion

Keep the original PNCP payload and document references.

Goals:

-   reproducibility;
-   auditing;
-   ability to reprocess with newer enrichment versions;
-   avoiding loss of source information.

### 5.2 Deterministic parsing

Use conventional code before using an LLM whenever possible.

Extract or normalize:

-   procurement ID;
-   portal/source;
-   organization;
-   modality;
-   dates;
-   municipality/state;
-   estimated value;
-   items;
-   quantities;
-   item prices;
-   descriptions;
-   participation rules already represented structurally;
-   document metadata.

For PDFs/HTML, extract text using deterministic parsers first.

### 5.3 Global AI enrichment

LLMs should enrich information that is difficult to derive
deterministically.

Possible enrichment fields:

-   normalized categories;
-   product/service concepts;
-   keywords and synonyms;
-   candidate CNAEs with confidence;
-   technical requirements;
-   required certificates;
-   qualification requirements;
-   required documents;
-   delivery requirements;
-   geographic constraints;
-   ME/EPP conditions;
-   important clauses;
-   risk flags;
-   complexity;
-   summary.

Example canonical representation:

``` json
{
  "procurement_id": "900123",
  "title": "Aquisição de materiais de escritório",
  "object": "Aquisição de materiais de escritório...",
  "categories": ["material_escritorio"],
  "keywords": ["lapis", "caneta", "papel"],
  "cnae_candidates": [
    {
      "code": "XXXX-X/XX",
      "confidence": 0.91
    }
  ],
  "items": [
    {
      "description": "Lápis preto nº 2",
      "quantity": 1000,
      "estimated_unit_price": 1.20
    }
  ],
  "estimated_value": 25000,
  "requirements": {
    "mei_allowed": null,
    "me_epp_preference": true,
    "technical_certificate": false
  },
  "documents": [],
  "delivery": {
    "location": "Rio de Janeiro/RJ",
    "deadline_days": 30
  },
  "dates": {
    "proposal_deadline": null
  },
  "enrichment": {
    "schema_version": "1.0",
    "model": "...",
    "confidence": 0.93
  }
}
```

------------------------------------------------------------------------

## 6. LLM cost strategy

LLMs should be routed by task complexity rather than using one expensive
model for everything.

### Tier 0 --- no LLM

Use PNCP structured fields, deterministic parsing, database queries,
rules, indexes and normal code.

### Tier 1 --- cheap/free classification

Use a low-cost model for:

-   categorization;
-   keyword/synonym generation;
-   candidate CNAEs;
-   structured extraction from clean text;
-   simple requirement detection.

### Tier 2 --- document-capable model

Use when deterministic extraction is insufficient:

-   scanned PDFs;
-   complex tables;
-   visual layout;
-   difficult attachments;
-   multimodal information.

### Tier 3 --- stronger reasoning

Use only when the value justifies it:

-   complete procurement analysis;
-   company-specific GO/NO-GO;
-   risk interpretation;
-   complex questions;
-   preparation of participation strategy.

The model provider must be abstracted. Do not couple Lixto to one
provider or model.

``` text
Classifier / Analyzer interface
          │
          ├── preferred cheap model
          ├── fallback model
          └── stronger model when required
```

Free OpenRouter models can reduce initial cost, but they should be
treated as an optimization rather than a production availability
guarantee.

------------------------------------------------------------------------

## 7. Storage and retrieval

For the MVP, prefer **PostgreSQL + pgvector** rather than introducing a
separate vector database.

Possible logical entities:

``` text
procurements
procurement_items
procurement_documents
procurement_requirements
procurement_categories
procurement_cnaes
procurement_embeddings
procurement_enrichments

organizations
organization_cnaes
organization_products
organization_capabilities
organization_documents
organization_preferences

matches
agent_runs
agent_actions
```

Use ordinary relational indexes and full-text search for
exact/structured filtering.

Use vector search only where semantic similarity adds value.

------------------------------------------------------------------------

## 8. Company profile

Lixto needs a rich organization profile to make customer-specific
decisions.

Possible inputs:

-   CNPJ;
-   CNAEs;
-   products/services;
-   synonyms for products;
-   geographic coverage;
-   minimum/maximum opportunity size;
-   margin constraints;
-   suppliers;
-   delivery capacity;
-   certifications;
-   qualification documents;
-   financial constraints;
-   preferred portals;
-   historical participation;
-   explicit user preferences.

This profile becomes the other side of the matching equation.

------------------------------------------------------------------------

## 9. Matching engine

The first matching stage should not require a powerful LLM.

``` text
global procurement enrichment
            +
company capability profile
            ↓
      deterministic /
       semantic score
            ↓
     candidate matches
            ↓
LLM only for ambiguous or
high-value interpretation
```

A score can consider:

-   product/service similarity;
-   CNAE compatibility;
-   location;
-   value;
-   deadlines;
-   documentation readiness;
-   technical requirements;
-   company preferences;
-   semantic similarity.

The matching engine should return both a score and machine-readable
reasons.

------------------------------------------------------------------------

## 10. Conversational-first UX

The main Lixto screen should feel like an AI assistant rather than a
traditional procurement ERP.

Example:

> **User:** Encontre licitações abertas que tenham lápis como item.

Lixto translates the request into a safe structured intent, for example:

``` json
{
  "intent": "search_procurements",
  "filters": {
    "status": "open",
    "item_query": "lápis"
  }
}
```

The backend --- **not the LLM** --- converts that intent into
database/search operations.

Avoid allowing the model to execute arbitrary SQL.

### Optional quick controls

Near the prompt field, expose lightweight controls such as:

-   Portal
-   Location
-   Modality
-   Status
-   Date
-   Value range

These are accelerators, not required fields.

Natural language remains the primary interaction model.

### Example queries

-   "Liste licitações abertas com lápis como item."
-   "Só no Rio de Janeiro."
-   "Quais dessas minha empresa pode participar?"
-   "Mostre as acima de R\$ 100 mil."
-   "Analise a segunda."
-   "Por que você acha que devemos participar?"
-   "Quais documentos estão faltando?"
-   "Prepare o que eu preciso para essa oportunidade."

The conversation becomes the thread that connects search, analysis and
eventual action.

------------------------------------------------------------------------

## 11. Conversational agent architecture

Conceptually:

``` text
User message
     ↓
Intent / tool selection
     ↓
Structured request
     ↓
┌───────────────┬────────────────┬─────────────────┐
│ SQL / filters │ semantic search│ procurement tool│
└───────┬───────┴───────┬────────┴────────┬────────┘
        └─────────────── context ──────────┘
                         ↓
                        LLM
                         ↓
                  conversational answer
```

The LLM should orchestrate safe tools rather than own the database.

Potential tools:

``` text
search_procurements
get_procurement
search_items
get_documents
analyze_procurement
compare_procurements
check_company_eligibility
calculate_match
list_missing_documents
recommend_go_no_go
prepare_participation
```

------------------------------------------------------------------------

## 12. Proactive agent mode

Conversational search is only one side of Lixto.

The proactive agent continuously evaluates newly ingested opportunities.

``` text
new procurement
      ↓
global enrichment
      ↓
candidate company selection
      ↓
matching
      ↓
high-quality opportunity?
      │
    yes
      ↓
deeper analysis
      ↓
recommendation / notification
```

Example daily experience:

``` text
Lixto analyzed 137 new opportunities.

23 matched your company.
5 deserve attention.

#1 — Procurement 1029/2026
Fit: 94%
Estimated value: R$ 184,000
Documentation: OK
Risk: Low

Recommendation: PARTICIPATE
```

The user can then continue conversationally:

> "Why?"

> "Compare this with opportunity #3."

> "What documents do I need?"

> "Prepare this one."

------------------------------------------------------------------------

## 13. Human approval and autonomy

Initial execution should follow a human-in-the-loop model.

``` text
Search
  ↓
Analyze
  ↓
Recommend
  ↓
Prepare
  ↓
 HUMAN APPROVAL
  ↓
Execute
```

The product can gradually increase autonomy after real-world validation.

Actions that create commitments, submit proposals, make bids, accept
terms or otherwise create meaningful consequences should have explicit
approval in the initial versions.

------------------------------------------------------------------------

## 14. Learning loop

Every real interaction can improve the system.

Capture:

-   recommended opportunities;
-   user accepted/rejected recommendations;
-   reason for rejection;
-   actual participation;
-   wins/losses;
-   price;
-   margin;
-   disqualification reasons;
-   missing documentation;
-   model confidence;
-   human corrections.

Over time this creates a proprietary dataset for:

-   better ranking;
-   better GO/NO-GO;
-   smaller specialized classifiers;
-   customer-specific preferences;
-   eventual reduction in LLM calls.

------------------------------------------------------------------------

## 15. Product positioning

Avoid positioning Lixto as:

> "Another procurement search platform with AI."

Prefer:

> **Lixto --- your AI agent for public procurement.**

The distinction is:

``` text
Traditional platform:
user operates software → software shows information

Lixto:
user states objective → agent searches, analyzes,
recommends and eventually executes
```

The table/list view can still exist as a secondary power-user interface,
but it should not define the product experience.

------------------------------------------------------------------------

## 16. MVP priorities

Build on the current PNCP system rather than rebuilding it.

Recommended order:

1.  Define canonical enrichment schema.
2.  Add deterministic document parsing.
3.  Add global enrichment worker.
4.  Add enrichment versioning/confidence.
5.  Add PostgreSQL indexes + pgvector where useful.
6.  Define organization capability profile.
7.  Implement initial match engine.
8.  Implement safe structured search tools.
9.  Build conversational-first interface.
10. Connect LLM to tools.
11. Add proactive opportunity recommendations.
12. Add deep analysis for selected opportunities.
13. Add human-approved preparation/actions.
14. Capture feedback/outcomes.

### Explicitly avoid in the first version

-   unnecessary multi-agent architecture;
-   separate vector infrastructure without demonstrated need;
-   reprocessing the same procurement per customer;
-   sending every complete PDF to an expensive LLM;
-   arbitrary LLM-generated SQL;
-   fully autonomous consequential actions;
-   large ERP-style UI before conversational workflows are validated.

------------------------------------------------------------------------

## 17. North-star workflow

The experience Lixto should ultimately optimize for is:

``` text
Lixto:
"Encontrei 5 oportunidades hoje que combinam com sua empresa."

User:
"Qual é a melhor?"

Lixto:
"A oportunidade 1029/2026 tem 94% de aderência.
Sua documentação atende aos requisitos e o risco é baixo."

User:
"Analise profundamente."

Lixto:
[performs deeper document/company analysis]

User:
"Prepare a participação."

Lixto:
[prepares required artifacts]

Lixto:
"Tudo pronto. Posso prosseguir?"

User:
"Sim."

Lixto:
[executes authorized steps]
```

That is the product direction: **from procurement search software to an
AI procurement operator.**

------------------------------------------------------------------------

## Appendix — Implementation status (as of 2026-08-25, after cycles 16–19)

### Built

| vision item | where |
|---|---|
| Raw ingestion, structured parse (§2, §5.1–5.2) | `lixto sync incremental`, `lixto sync details`, `procurements`/`procurement_items`/`procurement_documents` |
| Deterministic PDF text extraction + quality gate (§4, §5.2) | `src/lixto/enrich/documents.py` → `procurement_document_texts` |
| Cheap text LLM / multimodal LLM routing (§4, §6 tiers 1–2) | `src/lixto/llm.py` (OpenAI-compatible), `src/lixto/enrich/worker.py` (routes by input_kind) |
| Global enrichment, canonical JSON, versioned + confidence (§3, §5.3, MVP 1–4) | `procurement_enrichments` (schema_version 1.0), `lixto enrich run` |
| Provider abstraction (§6) | `LIXTO_LLM_*` env, OpenAI-compatible base URL |
| PostgreSQL FTS/structured indexes + pgvector (§7, MVP 5) | `pgvector/pgvector:pg16-trixie` (local) / `pg18-trixie` (prod); HNSW cosine index on `procurement_embeddings` |
| Company profile — CNAEs, products, keywords, exclusions, UFs, value range, size, documents (§8, MVP 6) | `companies`, `company_cnaes`, `company_profiles`, `company_documents`, `/company/profile` form |
| Match engine: deterministic + semantic score with machine-readable reasons (§9, MVP 7) | `web/lib/match-engine.ts` (on-demand, 15 reason codes) |
| Safe structured tools, no LLM SQL (§10–11, MVP 8, 10) | `web/lib/agent/tools.ts` — 5 tools (`search_procurements`, `search_my_matches`, `get_procurement`, `calculate_match`, `analyze_procurement`) |
| Conversational-first UI + quick controls (§10, MVP 9) | `/lixto` chat, `web/components/chat/*`, `POST /api/chat`, `conversations`/`messages` tables |
| Annual Procurement Plans (PCA) (§14) | `procurement_plans`, `procurement_plan_items`, `/v1/pca/atualizacao` sync (cycle 18) |
| Contracts + amendments (supplier history, competitive intelligence) (§14) | `contracts`, `contract_amendments`, `/v1/contratos/atualizacao` + `/termos` sync (cycle 18) |
| Agent run tracking (§7, §11) | `agent_runs` table, every sync/enrich/chat operation logged |
| Proactive agent mode (§12): batch match, bounded GO/NO-GO, digest, feedback capture | `lixto match run` → `matches`/`opportunities` tables (score ≥40), `lixto recommend run` → `recommendations` (score ≥70, cap 5/company/day), `/lixto` digest, `/opportunities` list, feedback to `opportunity_feedback` (cycle 19) |
| Query-time semantic search (§7): embed user's free text, hybrid FTS ∪ cosine retrieval, reciprocal-rank fusion | Free-text search via `search_procurements` tool and `/procurements` page; constants (`SEARCH_SEMANTIC_TOP_K=200`, `SEARCH_SEMANTIC_MIN=0.4`, `RRF_K=60`) in `web/lib/procurement-queries.ts`; `lixto enrich embed` backfills missing vectors (cycle 20) |

### Not built (open items)

| vision item | status | notes |
|---|---|---|
| HTML parsing (§5.2) | skipped | PNCP attachments are PDFs; revisit if other portals ingested |
| WhatsApp/push notifications for new opportunities | not built | email built (cycle 22); WhatsApp/push still open |
| Prepare / execute / human-approval workflow (§13, MVP 13) | not built | `agent_actions` table placeholder exists for cycle 20 |
| Additional tools: `search_items`, `get_documents`, `compare_procurements`, `check_company_eligibility`, `list_missing_documents`, `prepare_participation` (§11) | not built | 5 of 12 listed tools exist |
| Learning from feedback: ranking improvements based on acceptance/dismissal patterns (§14) | not built | feedback captured in `opportunity_feedback`; model retraining not yet implemented |
| On-demand deep analysis with a Tier-3 model (§6, MVP 12) | not built | `analyze_procurement` uses enrichment cached at ingest time |
| Per-page watermark for plans sync; plans/contracts in matching (§8) | not built | plans table exists; semantic matching not yet integrated |
| Richer profile fields: suppliers, delivery capacity, margins, financial constraints, preferred portals, historical participation (§8) | partial | only base fields implemented |
| Streaming chat responses | not built | single JSON reply per turn |

### Cycle 19 — Proactive mode (built)

**Completed**:
- Batch match: company profiles × procurements → persisted `matches` table (score ≥40)
- Bounded GO/NO-GO: top 5 opportunities per company per day (score ≥70) via `recommendations` table
- In-app digest: `/lixto` shows summary + attention cards; `/opportunities` lists by state; `/dashboard` links to digest
- Feedback capture: `opportunity_feedback` table; users can dismiss with reason or mark interest

### Cycle 20 — Query-time semantic search (built)

**Completed**:
- Hybrid retrieval: free-text search embeds via `embedQuery`; candidates = FTS ∪ top-200 cosine (≥0.4)
- Reciprocal-rank fusion (k=60) for deterministic blended ranking
- Structured filters (UF, modalidade, valor, situação) apply as hard WHERE on both branches; facets keyword-only
- Null embedding fallback: on key/provider error, degrades to keyword-only search
- Rows carry `match_kind` ('keyword'/'semantic'/'both') so chat/UI can explain hits
- Backfill schedule: `enrich-embed` runs 15 min after `enrich-run` (45 7,14,21 * * *) to heal ingestion-time failures

### Cycle 21 — Cost-fenced go-live (built)

**Completed**:
- Cost fence: details + enrichment restricted to top-3 portals, modalities 6/8, open/upcoming status via env config (§1, §2)
- Hard daily cap: `LIXTO_ENRICH_DAILY_CAP` rows/day; stops when reached with visibility (§3)
- Gemini primary + OpenAI fallback: `LIXTO_LLM_BASE_URL` points to Gemini's OpenAI-compatible endpoint; doc tier uses chat completions with inline PDF `file` parts (§4)
- Tier-0 ME/EPP: derived from `procurement_items.benefit_type_id` at enrichment write time; LLM schema drops these fields (§5)
- Cost reporting: `lixto status` shows today's tokens/USD and last 7 days' total (§3)
- Go-live runbook: `lixto backfill --days 45 → enrich run (cap) → enable schedules in order` (README.md)
- Prod ingestion schedules enabled (user decision in Dokploy; §6)

### Cycle 22 — Transactional email (built)

**Completed**:
- Persisted outbox: `email_messages` table with idempotent send, status tracking (queued|sending|sent|failed|suppressed), bounded retries + backoff
- Four templates: welcome (account created), invite (token accept), password_reset (token + link), daily_digest (opportunities only when score ≥70)
- Worker dispatch: `lixto email worker [--limit N]` drains outbox; digest enqueue via `lixto email digest [--company-id N]`
- Hard bounce suppression: `email_suppressions` table blocks future sends to bounced addresses; digest unsubscribe via footer link
- Self-hosted MTA: Postfix + opendkim on plugu-prod01 (187.127.16.246) delivering direct-to-MX; rate-limited below Hostinger's 5 msg/min cap
- DNS as code: Terraform manages Cloudflare zone (mail.lixto.com.br A, MX, SPF, DKIM, DMARC); PTR set manually
- Status visibility: `lixto status` email block shows queued, sent (24h), failed (24h), suppressed
- Deploy runbook: Terraform → deploy MTA → extract DKIM → re-apply → set PTR → test (README.md)
- Escape hatch: `relayhost` on 587/465 for external submission if IP reputation issues

### Cycle 23 — Chat interface removal

**Completed**:
- Removed the conversational `/lixto` chat page and agent loop (`POST /api/chat`, chat components) — the interface was unused surface with ongoing LLM budget risk. Proactive agent (match/recommend/digest) and all search tools remain; opportunity digest now surfaces through `/dashboard` and `/opportunities` list instead.

### Cycle 20+ roadmap

**High priority** (needed for production feedback loop):
- Email/WhatsApp/push notifications for new attention-scoring opportunities
- Prepare/execute workflows with human approval (via `agent_actions`)
- Learning from feedback: use acceptance/dismissal patterns to improve ranking and recommendations

**Medium priority**:
- Additional chat tools (`search_items`, `get_documents`, `compare_procurements`, `prepare_participation`)
- Streaming chat responses for long-running analyses
- Plans/contracts in opportunity matching (currently enrichment only)
