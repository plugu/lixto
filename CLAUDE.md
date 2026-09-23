# Claude Code Guidelines (Lixto)

This file guides any Claude agent working on Lixto.

## Graphify (Knowledge Graph)

This project uses graphify for codebase navigation.

- **Read first**: `graphify-out/GRAPH_REPORT.md` before reading any source files
- **Query the graph**: Use `graphify query "<question>"`, `graphify path "<A>" "<B>"`, or `graphify explain "<concept>"` for cross-module relationships
- **Keep it fresh**: After code changes, run `graphify update .` (AST-only, no API cost)
- **Wiki**: Check `graphify-out/wiki/index.md` if it exists; it's the graph's high-level map

## Lixto Core (Cycle 18)

**Signup is gated**: Companies start in `pending` approval status; only superadmins (CLI-only flag) can approve them.

### Data Model

**Read first**: `docs/adr/001-lixto-data-model.md` before modifying any schema.

Key facts:
- New database `lixto` (owned by role `lixto`) on `pg-shared` (prod) / local docker-compose (dev)
- English identifiers, plural table names (`procurements`, `companies`, `matches`)
- Schema version 1.0 in `migrations/001_core.sql` — **do not alter these tables in cycle 18**; if a column is missing, your ticket is wrong
- Surrogate keys (`BIGSERIAL id`) on ingested entities; `(source, source_id)` natural key for public IDs
- No raw JSON on hot tables; payloads stored in `source_payloads` for reprocessing

### CLI Discovery Contract

**Package**: `src/lixto` (Python 3.12+)

**CLI entry**: `src/lixto/cli/__init__.py` — auto-discovers commands. To add a command:
1. Create a module in `src/lixto/cli/` (e.g., `my_command.py`)
2. Export `name` (string) + `app` (typer.Typer) for a command group, OR `register(root: typer.Typer)` for top-level commands
3. It's mounted automatically; run `lixto --help` to verify

**Example**: `lixto sync incremental`, `lixto analyze run`, `lixto status`

### Environment Variables

| Prefix | Purpose | Examples |
|---|---|---|
| `LIXTO_DATABASE_URL` | PostgreSQL connection | `postgresql://lixto:lixto@localhost:5433/lixto` |
| `LIXTO_LLM_BASE_URL` | Primary LLM provider base URL (OpenAI-compatible) | `https://generativelanguage.googleapis.com/v1beta/openai/` (Gemini) |
| `LIXTO_LLM_API_KEY` | Primary provider API key | — |
| `LIXTO_LLM_MODEL_*` | Model tiers (CHEAP, DOC, STRONG, EMBED) | `gemini-3.5-flash-lite`, `gemini-3.7-flash`, etc. |
| `LIXTO_LLM_FALLBACK_BASE_URL` | Secondary provider base URL (used on primary error) | `https://api.openai.com/v1` (OpenAI) |
| `LIXTO_LLM_FALLBACK_API_KEY` | Secondary provider API key | — |
| `LIXTO_LLM_FALLBACK_MODEL_*` | Fallback model tiers (CHEAP, DOC, STRONG) | `gpt-5-mini`, `gpt-5.1`, etc. |
| `LIXTO_RECOMMEND_MODEL` | Recommendation model (GO/NO-GO, Tier-3) | `gemini-3.7-flash` |
| `LIXTO_FENCE_PORTALS` | Comma-separated list of allowed portals (cost fence) | `Compras.gov.br,ECustomize Consultoria em Software S.A,IPM Sistemas` |
| `LIXTO_FENCE_MODALITIES` | Comma-separated modality IDs (cost fence) | `6,8` |
| `LIXTO_FENCE_OPEN_ONLY` | Restrict to open/upcoming procurements (cost fence) | `1` |
| `LIXTO_ENRICH_DAILY_CAP` | Max analyses/day (cron); 0 or unset = unlimited | `1500` |
| `LIXTO_ANALYZE_MAX_BYTES` | Combined byte cap for a procurement's active PDFs | `60` (MB) |
| `LIXTO_ANALYZE_MAX_CHARS` | Character cap for LLM prompt (default 400,000) | `400000` |
| `LIXTO_ANALYZE_USER_DAILY_CAP` | Max on-demand analyses per company/day (web) | `10` |
| `LIXTO_IBGE_CNAE_URL` | CNAE seed source | `https://concla.ibge.gov.br/export/tabelas/ascii/subclasses.txt` |
| `LIXTO_MIN_REQUEST_INTERVAL` | Seconds between PNCP requests | `0.5` |
| `UPLOADS_DIR` | Document storage | `./uploads` (dev), `/app/uploads` (prod) |
| `LIXTO_SMTP_HOST` | SMTP server (transactional email) | `lixto-mail` (prod, Docker network), `localhost` (dev) |
| `LIXTO_SMTP_PORT` | SMTP port | `25` |
| `LIXTO_EMAIL_FROM` | Sender name + address | `Lixto <nao-responda@lixto.com.br>` |
| `LIXTO_EMAIL_REPLY_TO` | Reply-To header (optional) | — |
| `LIXTO_BOUNCE_MAILDIR` | DSN maildir shared by `lixto-mail` and `lixto-web` | `/var/db/mail/bounces` |
| `LIXTO_BOUNCE_ADDRESS` | Address the MTA accepts DSNs for | `bounces@lixto.com.br` |
| `LIXTO_APP_URL` | Web app base URL (used in email links) | `https://lixto.com.br` (prod), `http://localhost:3000` (dev) |
| `LIXTO_RADAR_HORIZON_DAYS` | Days into the future to scan for planned procurements | `365` |
| `LIXTO_RADAR_EMBED_LIMIT` | Max plan items to embed per run; 0 or unset = unlimited | `0` |
| `LIXTO_RADAR_WEIGHT_PCA_ITEM` | Opportunity score weight: item exists in a plan | `50` |
| `LIXTO_RADAR_WEIGHT_DATE_NEAR` | Opportunity score weight: desired date ≤90 days ahead | `30` |
| `LIXTO_RADAR_WEIGHT_DATE_MID` | Opportunity score weight: desired date 90–180 days ahead | `15` |
| `LIXTO_RADAR_WEIGHT_RECENT_UPDATE` | Opportunity score weight: plan updated within 60 days | `20` |
| `LIXTO_RADAR_ANALYSIS_MODEL` | LLM for on-demand Radar opportunity analysis (falls back to `LIXTO_RECOMMEND_MODEL`, then `gpt-5.1`) | — |
| `LIXTO_RADAR_ANALYSIS_DAILY_CAP` | Max AI analyses per company per day; 0 = unlimited | `20` |

**Note**: All `LIXTO_*` vars are read by Python (CLI); `web` also reads LLM, embedding, email, and Radar vars via `.env.local`.

### Production Deployment

**Dokploy**:
- Project: `lixto` (renamed from `plataforma-licitante`)
- Apps: `lixto-web` (Next.js) + `lixto-cli` (Python, sleeps forever on `ENTRYPOINT ["sleep", "infinity"]`) + `lixto-mail` (Postfix + opendkim MTA, from `infra/mail/Dockerfile`)
- Schedules on `lixto-cli` (state 2026-09-08; the README "Production Schedules" table is the authoritative list with LLM-cost flags):
  - `sync-incremental` — `0 6,13,20 * * *` (pull procurements, then `; lixto enrich embed` so new open tenders get vectors right after ingest — `;` because sync exits non-zero on any failed modality)
  - `results-sync` — `0 3 * * *` (homologated results; enabled for case outcomes)
  - `plans-sync` — `0 4 * * *` (pull annual procurement plans; DISABLED until Radar go-live — first run needs `--since`)
  - `plans-embed` — `20 4 * * *` (`lixto plans embed --limit 2000`, Radar embeddings; DISABLED — spends embedding tokens, LLM provider undecided)
  - `radar-run` — `40 4 * * *` (detect future opportunities, expire stale ones, score per company; DISABLED until PCA data exists)
  - `radar-seed` — manual only (`0 0 31 2 *`; `plans sync --since … && plans embed --limit 2000 && radar run`)
  - `contracts-sync` — `0 5 * * *` (DISABLED; manual only)
  - `analyze-run` — `30 7,14,21 * * *` (deep analysis cron; DISABLED by decision — analysis is on-demand only)
  - `analyze-jobs` — `*/2 * * * *` (drain on-demand "Analisar com IA" queue)
  - `match-run` — `0 8,15,22 * * *` (score procurements vs profiles)
  - `recommend-run` — `15 8 * * *` (GO/NO-GO for top opportunities)
  - `cases-run` — `45 8,20 * * *` (turn GO recommendations into cases, compute verdicts, email, request results, resolve outcomes)
  - `enrich-embed` — manual only (`0 0 31 2 *`; catch-up for the embed chained after sync)
  - `email-worker` — `*/5 * * * *` (drain outbox every 5 min)
  - `email-bounces` — `2-57/5 * * * *` (ingest DSN maildir, offset 2 min from worker)
  - `email-digest` — `30 8 * * *` (enqueue digest at 8:30 AM)
  - `db-init` — manual only (`0 0 31 2 *`)

**Note on schedules**: Date `0 0 31 2 *` never fires (Feb 31st). Use for "manual only" jobs.

### Key Code Locations

| What | Where |
|---|---|
| Schema DDL | `migrations/001_core.sql` (READ FIRST); `migrations/005_radar.sql` (Radar tables) |
| CLI commands | `src/lixto/cli/*.py` |
| Sync logic | `src/lixto/sync/*.py` (procurements, plans, contracts, results, etc.) |
| Analysis worker | `src/lixto/analyze/worker.py` (LLM routing, facets + dossier) |
| Analysis UI | `web/components/analysis-panel.tsx` |
| Analysis queries | `web/lib/analysis-queries.ts` |
| Plan-item embeddings | `src/lixto/enrich/plan_embed.py` (backfill for Radar) |
| LLM client | `src/lixto/llm.py` (OpenAI-compatible, provider abstraction) |
| PNCP client | `src/lixto/pncp_client.py` |
| Database | `src/lixto/db.py` (connection, migrations) |
| Session & auth | `web/lib/auth.ts` (session gate, `requireSuperadmin`, company approval check on every request) |
| Public-page session helpers | `web/lib/public-pages.ts`, `web/lib/safe-next.ts` (logged-in redirect off /login & /signup; safe `?next=`); `web/components/marketing/header-actions.ts` |
| Superadmin CLI | `src/lixto/cli/users.py` (grant/revoke/list superadmin flags) |
| Company approval | `web/app/(app)/admin/*` (superadmin dashboard: Pendentes/Aprovadas/Rejeitadas tabs); `web/lib/company-approval-queries.ts` (approval queries) |
| Company approval schema | `migrations/007_company_approval.sql` (companies.approval_status, users.is_superadmin) |
| Web routes | `web/app/(app)/*` (Next.js app dir) |
| Radar engine | `web/lib/radar-engine.ts`, `web/lib/radar-batch.ts` (detection, scoring, expiry) |
| Radar routes | `web/app/(app)/radar/*` (/radar list, /radar/[id] detail) |
| Radar analysis | `web/lib/radar-analysis.ts` (on-demand AI analysis) |
| Match engine | `web/lib/match-engine.ts` (deterministic scoring) |
| Case agent | `web/lib/case-batch.ts`, `web/lib/case-verdict.ts`, `web/lib/case-queries.ts`; routes `web/app/(app)/cases/*`; CLI `src/lixto/cli/cases.py`; schema `migrations/008_cases.sql` |
| Embeddings/LLM (web) | `web/lib/agent/embed.ts`, `web/lib/agent/llm.ts` (semantic search, recommend) |
| Database queries | `web/lib/*-queries.ts` |
| URL state & filters | `web/lib/url-state.ts`, `web/lib/procurement-url.ts`, `web/lib/radar-url.ts` (URL contracts, no root form builders) |
| Keyboard shortcuts | `web/lib/keyboard-shortcuts.ts` (bindings: `g r/p/l`, `?`; pure chord matcher) |
| Command palette | `web/components/ui/command-search.tsx`, `web/lib/command-search-queries.ts` (⌘K live search) |
| Theme toggle | `web/components/ui/theme-toggle.tsx` (`lixto.theme` localStorage, `data-theme` on `<html>`) |
| Dark mode tokens | `web/app/globals.css` (`@theme` block with `--color-*` custom properties) |
| Optimistic actions | `web/components/opportunity-feedback.tsx` (`useOptimistic` + sonner toast with undo) |

### Guiding Principles

1. **Process once, reuse globally**: Enrich procurements once (globally); match on-demand per company profile.
2. **Deterministic first**: Use code before LLM. LLM only for classification, summarization, analysis of free-form text/PDFs.
3. **No LLM SQL**: All search goes through typed query builders with bound params (`web/lib/*-queries.ts`); an LLM never generates SQL.
4. **Source abstraction**: Every ingested entity carries `(source, source_id)`. Today one source: 'pncp'. Next portal = new adapter, not schema change.
5. **Watermark idempotence**: Store `dataAtualizacaoGlobal` in `sync_state`; re-runs skip already-processed rows.
6. **Raw retention**: `source_payloads` keeps complete DTOs for reprocessing without re-fetching.

### Mode: Production

Per PRODUCT.md, this is a **production-level project**.
- Full test discipline (ruff, pytest, tsc, vitest).
- No TODOs or hardcoded config.
- Zero shortcuts.

### Radar (Cycle 24)

**Product**: Future procurement discovery. Every PCA (annual procurement plan) item in the horizon is scored once (opportunity score: will it happen, and soon?) and then matched per company (company match score: does it fit this seller's profile?). One opportunity = one PCA item, traceable. Deterministic "why" always rendered from signals; "Analyze with AI" is on-demand, cached per opportunity×company, zero LLM spend for unopened items.

**Two separate scores**:
- *Opportunity score* (0–100): PCA item base weight + date proximity bands + plan recency. Weights from `LIXTO_RADAR_WEIGHT_*` env vars (defaults: PCA=50, DateNear=30, DateMid=15, RecentUpdate=20). No LLM.
- *Company match score* (0–100): Profile terms FTS on item, states vs agency state, value band, cosine similarity (profile embedding vs plan-item embedding). No LLM per item. Minimum 40 to persist.

**Status lifecycle**: `predicted` (detected in horizon) → `procurement_found` (V2 linker found the tender) or `expired` (desired date passed or item removed from plan). `detected_at` is never rewritten; it is the evidence of early discovery.

**Schema** (five tables in `migrations/005_radar.sql`): `plan_item_embeddings`, `future_opportunities`, `future_opportunity_matches`, `future_opportunity_actions`, `future_opportunity_analyses`. Future opportunities have *no FK on item_number* (items are replaced delete+insert on plan update; opportunity must survive that).

## Before You Touch Schema

**Stop and read `docs/adr/001-lixto-data-model.md`** top-to-bottom. Every table, index, and constraint is intentional for cycle 18. Missing columns or queries are bugs in the ticket, not in the schema.

## Architecture & Vision

- `docs/ARCHITECTURE.md` — current pipeline, LLM tiers, scoring, tools
- `docs/VISION.md` — product roadmap and implementation status
- `docs/DATA_MODEL.md` — table-by-table reference
- `docs/PNCP_API.md` — PNCP endpoints and DTO fields
- `README.md` — quick start and CLI reference

## Cycle 18 Boundaries

**In scope**: New schema, new CLI, new web routes, PNCP sync (procurements, plans, contracts), enrichment, matching.

**Out of scope**: Legacy data migration (DB starts fresh); legacy code deletion (separate ticket 85); landing page copy; Ollama classifier; learning loop; proactive mode; deep analysis; prepare/execute workflows.

**Note**: Conversational chat interface was removed in cycle 23 (ticket 122) as unused surface; proactive agent (match/recommend/digest) and search tools remain.
