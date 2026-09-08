# Agent Quick Reference — Lixto

**One-page guide for coding agents. See CLAUDE.md for full context.**

## Project At a Glance

Lixto is an AI agent for public procurement (PNCP → PostgreSQL → enrichment → chat).

- **Repo**: github.com/alexazevedo/lixto (renamed from plataforma-licitante, cycle 18)
- **Database**: `lixto` (PostgreSQL 16+ with pgvector) on `pg-shared` (prod) or docker-compose (dev)
- **Package**: `src/lixto` (Python 3.12+), CLI `lixto`
- **Web**: Next.js app at `web/` (TypeScript), routes in `web/app/(app)/`
- **Mode**: Production (full test discipline, no TODOs)

## Critical Files to Read First

1. **Schema**: `docs/adr/001-lixto-data-model.md` — DO NOT ALTER TABLES NAMED IN THIS FILE (they're fixed in cycle 18)
2. **API**: `docs/PNCP_API.md` — DTO field mappings (procurements, items, docs, plans, contracts, amendments)
3. **Architecture**: `docs/ARCHITECTURE.md` — pipeline, LLM tiers, scoring, tools
4. **Data model**: `docs/DATA_MODEL.md` — table reference
5. **Vision**: `docs/VISION.md` — product direction and what's not built yet

## CLI Commands

See `README.md` for full list. Key ones:

```bash
lixto db init                              # Apply migrations (runs on container start)
lixto cnae seed                            # Seed IBGE CNAE codes
lixto backfill [--since YYYY-MM-DD]       # Full historical fetch
lixto sync incremental [--max-details N]   # Incremental (scheduled 6am/1pm/8pm)
lixto sync details [--limit N]             # Fetch items/docs for procurements missing them
lixto results sync [--limit N]             # Drain demand queue (scheduled 3am)
lixto plans sync [--since] [--until]       # PCA (scheduled 4am, disabled)
lixto contracts sync [--max-amendments N]  # Contracts (scheduled 5am, disabled)
lixto analyze run [--limit N] [--days N]   # Deep analysis (scheduled 7:30am/2:30pm/9:30pm)
lixto analyze jobs [--limit N]             # On-demand analysis queue (scheduled every 2 min)
lixto enrich embed [--limit N]             # Backfill embeddings (manual)
lixto status                               # Print database stats
```

## Environment Variables

**Python/CLI read these** (prefix `LIXTO_`):
- `DATABASE_URL` — PostgreSQL (default: local docker-compose)
- `LLM_BASE_URL` — OpenAI-compatible provider base URL
- `LLM_API_KEY` — API key (fallback: `OPENAI_API_KEY`)
- `LLM_MODEL_CHEAP` — Text model (gpt-4o-mini)
- `LLM_MODEL_DOC` — PDF model (gpt-4o, OpenAI only)
- `LLM_MODEL_STRONG` — Deep reasoning (gpt-4o)
- `LLM_MODEL_FALLBACK` — Retry tier (optional)
- `LLM_MODEL_EMBED` — Embeddings (text-embedding-3-small)
- `CHAT_MODEL` — Chat model (gpt-4o-mini)
- `IBGE_CNAE_URL` — CNAE seed source
- `MIN_REQUEST_INTERVAL` — Seconds between PNCP requests (0.5)

**Web reads** LLM vars via `.env.local`.

## Code Locations

| Task | File(s) |
|---|---|
| Add a CLI command | `src/lixto/cli/*.py` (auto-discovered) |
| Modify sync logic | `src/lixto/sync/*.py` |
| Change analysis routing | `src/lixto/analyze/worker.py` |
| Swap LLM provider | `src/lixto/llm.py` + env vars (no code change) |
| Add a web route | `web/app/(app)/route-name/page.tsx` (Next.js app dir) |
| Add a tool for chat | `web/lib/agent/tools.ts` (only safe SQL, no model access) |
| Modify match scoring | `web/lib/match-engine.ts` (reason codes must sync with chat/tools.ts) |
| Query database from web | `web/lib/*-queries.ts` (query builders, never model-generated SQL) |
| Run tests | `uv run pytest -q`, `npm test` (web) |
| Lint/format | `uv run ruff check/format src/lixto`, `npm run lint` (web) |

## Key Data Structures

**Procurements table** (PNCP sync):
- Surrogate key: `id` (BIGSERIAL)
- Natural key: `(source='pncp', source_id=numeroControlePNCP)`
- Denormalized: `state`, `city_name` (from unit)
- Watermark: `source_global_updated_at` (stored in `sync_state`)
- Indexes on: `state`, `modality_id`, `published_at`, `proposal_closes_at`, `agency_tax_id`

**Enrichments** (global, one per open procurement):
- `procurement_enrichments` → facet tables: `procurement_categories`, `procurement_requirements`, `procurement_cnaes`, `procurement_embeddings`
- Routing: text/structured → cheap tier, PDF → doc tier, no document → structured only
- Input kind tracked: `input_kind` ∈ {structured, text, pdf}

**Matching** (on-demand, per company):
- Company profile: `company_profiles.terms` (normalized keywords/products), `exclusion_terms`, `states`, `min_value`, `max_value`
- Match score: 0–100, with reason codes (15 types: cnae_primary, cnae_secondary, term_enrichment, term_text, state_ok, state_out, value_ok, value_out, value_unknown, me_epp_exclusive, requires_certification, requires_technical_certificate, exclusion, semantic_high, semantic, no_profile)
- Computed on-demand by `web/lib/match-engine.ts` (deterministic, no LLM)

**Agent runs** (audit trail):
- `agent_runs`: kind (sync.procurements, sync.details, sync.results, sync.plans, sync.contracts, enrich, embed, chat, match), status (running, done, failed), counters (JSONB), error
- Every CLI run and chat turn logged

**Chat** (per-company, per-user):
- `conversations` → `messages`
- Message roles: user, assistant, tool
- Tools: search_procurements, search_my_matches, get_procurement, calculate_match, analyze_procurement
- Refs (procurement cards) denormalized in messages for display

## Common Traps

1. **Schema is read-only in cycle 18** — don't add columns to tables in `001_core.sql`. Wait for cycle 19.
2. **No LLM SQL** — model calls tools by name + JSON args; tools validate and call query builders.
3. **Company ID from session only** — tools never accept it as an argument.
4. **Watermarks** — only advance after a chunk succeeds; on partial failure, advance to max timestamp seen + note error.
5. **Results endpoint pagination** — it silently ignores `pagina`; always fetch page 1 only.
6. **PCA volume** — ~200k rows / 3-day window; HTTP 200 with empty body on retries (idempotent).
7. **Match score clamping** — reasons have raw weights (sum >100); final score clamped 0–100 for UI.

## Schedules (Production)

Dokploy project `lixto`, app `lixto-cli`, timezone America/Sao_Paulo:

| Schedule | Cron | Command | Enabled |
|---|---|---|---|
| sync-incremental | `0 6,13,20 * * *` | `lixto sync incremental --max-details 2000` | ✓ |
| results-sync | `0 3 * * *` | `lixto results sync --limit 2000` | ✓ |
| plans-sync | `0 4 * * *` | `lixto plans sync` | ✗ |
| contracts-sync | `0 5 * * *` | `lixto contracts sync --max-amendments 500` | ✗ |
| analyze-run | `30 7,14,21 * * *` | `lixto analyze run --days 30 --limit 300` | ✓ |
| analyze-jobs | `*/2 * * * *` | `lixto analyze jobs --limit 50` | ✓ |
| enrich-embed | `0 0 31 2 *` | `lixto enrich embed` | ✗ |
| db-init | `0 0 31 2 *` | `lixto db init` | ✗ |

Feb 31st (`0 0 31 2 *`) never fires → manual only.

## Before You Code

- [ ] Read `CLAUDE.md` (full context)
- [ ] Read the ticket spec and understand the scope
- [ ] Read `docs/adr/001-lixto-data-model.md` if touching schema
- [ ] Read `docs/PNCP_API.md` if touching sync
- [ ] Read `docs/ARCHITECTURE.md` if modifying pipeline/LLM/tools
- [ ] Check existing code patterns (grep, graphify query)
- [ ] Run tests: `uv run pytest -q src/lixto tests/lixto` + `npm test` (web)
- [ ] Run linters: `uv run ruff check src/lixto` + `npm run lint` (web)

## Useful Commands

```bash
# Local dev
docker compose up -d                        # Start DB
uv run lixto db init                        # Init schema
cd web && npm install && npm run dev        # Start web (localhost:3000)

# Inspect DB
docker compose exec db psql -U lixto -d lixto -c "SELECT COUNT(*) FROM procurements;"

# Check LLM config
echo $LIXTO_LLM_MODEL_CHEAP $LIXTO_LLM_MODEL_DOC $LIXTO_LLM_MODEL_STRONG

# Run a one-off sync
uv run lixto sync incremental --until 2026-08-26 --max-details 100

# Test with limit
uv run lixto analyze run --limit 5 --retry-errors
```

## When You're Done

1. All tests pass: `uv run ruff check/format`, `uv run pytest -q`, `npm run lint`, `npm run build` (web)
2. Commit on main with message including ticket number
3. Report changes in ≤200 words: files, test results, findings

**Read CLAUDE.md for the full context.**
