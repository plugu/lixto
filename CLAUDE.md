# Claude Code Guidelines (Lixto)

This file guides any Claude agent working on Lixto.

## Graphify (Knowledge Graph)

This project uses graphify for codebase navigation.

- **Read first**: `graphify-out/GRAPH_REPORT.md` before reading any source files
- **Query the graph**: Use `graphify query "<question>"`, `graphify path "<A>" "<B>"`, or `graphify explain "<concept>"` for cross-module relationships
- **Keep it fresh**: After code changes, run `graphify update .` (AST-only, no API cost)
- **Wiki**: Check `graphify-out/wiki/index.md` if it exists; it's the graph's high-level map

## Lixto Core (Cycle 18)

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

**Example**: `lixto sync incremental`, `lixto enrich run`, `lixto status`

### Environment Variables

| Prefix | Purpose | Examples |
|---|---|---|
| `LIXTO_DATABASE_URL` | PostgreSQL connection | `postgresql://lixto:lixto@localhost:5433/lixto` |
| `LIXTO_LLM_MODEL_*` | Model tiers (CHEAP, DOC, STRONG, FALLBACK, EMBED) | `gpt-4o-mini`, `gpt-4o`, etc. |
| `LIXTO_LLM_BASE_URL` | LLM provider base URL | `https://api.openai.com/v1` |
| `LIXTO_LLM_API_KEY` | LLM API key (fallback: `OPENAI_API_KEY`) | — |
| `LIXTO_CHAT_MODEL` | Chat model | `gpt-4o-mini` |
| `LIXTO_IBGE_CNAE_URL` | CNAE seed source | `https://concla.ibge.gov.br/export/tabelas/ascii/subclasses.txt` |
| `LIXTO_MIN_REQUEST_INTERVAL` | Seconds between PNCP requests | `0.5` |
| `UPLOADS_DIR` | Document storage | `./web/uploads` (dev), `/app/uploads` (prod) |

**Note**: All `LIXTO_*` vars are read by Python (CLI); `web` also reads LLM vars via `.env.local`.

### Production Deployment

**Dokploy**:
- Project: `lixto` (renamed from `plataforma-licitante`)
- Apps: `lixto-web` (Next.js) + `lixto-cli` (Python, sleeps forever on `ENTRYPOINT ["sleep", "infinity"]`)
- Schedules on `lixto-cli` (all disabled in cycle 18; enable as needed):
  - `sync-incremental` — `0 6,13,20 * * *`
  - `results-sync` — `0 3 * * *`
  - `plans-sync` — `0 4 * * *` (disabled)
  - `contracts-sync` — `0 5 * * *` (disabled)
  - `enrich-run` — `30 7,14,21 * * *`
  - `enrich-embed` — manual only (`0 0 31 2 *`)
  - `db-init` — manual only (`0 0 31 2 *`)

**Note on schedules**: Date `0 0 31 2 *` never fires (Feb 31st). Use for "manual only" jobs.

### Key Code Locations

| What | Where |
|---|---|
| Schema DDL | `migrations/001_core.sql` (READ FIRST) |
| CLI commands | `src/lixto/cli/*.py` |
| Sync logic | `src/lixto/sync/*.py` (procurements, plans, contracts, results, etc.) |
| Enrichment | `src/lixto/enrich/worker.py` (LLM routing) |
| LLM client | `src/lixto/llm.py` (OpenAI-compatible, provider abstraction) |
| PNCP client | `src/lixto/pncp_client.py` |
| Database | `src/lixto/db.py` (connection, migrations) |
| Web routes | `web/app/(app)/*` (Next.js app dir) |
| Match engine | `web/lib/match-engine.ts` (deterministic scoring) |
| Tools | `web/lib/agent/tools.ts` (safe structured search) |
| Chat API | `web/app/(app)/api/chat/route.ts` |
| Database queries | `web/lib/*-queries.ts` |

### Guiding Principles

1. **Process once, reuse globally**: Enrich procurements once (globally); match on-demand per company profile.
2. **Deterministic first**: Use code before LLM. LLM only for classification, summarization, analysis of free-form text/PDFs.
3. **No LLM SQL**: Model orchestrates tools (`search_procurements`, etc.); tools call query builders with bound params.
4. **Source abstraction**: Every ingested entity carries `(source, source_id)`. Today one source: 'pncp'. Next portal = new adapter, not schema change.
5. **Watermark idempotence**: Store `dataAtualizacaoGlobal` in `sync_state`; re-runs skip already-processed rows.
6. **Raw retention**: `source_payloads` keeps complete DTOs for reprocessing without re-fetching.

### Mode: Production

Per PRODUCT.md, this is a **production-level project**.
- Full test discipline (ruff, pytest, tsc, vitest).
- No TODOs or hardcoded config.
- Zero shortcuts.

## Before You Touch Schema

**Stop and read `docs/adr/001-lixto-data-model.md`** top-to-bottom. Every table, index, and constraint is intentional for cycle 18. Missing columns or queries are bugs in the ticket, not in the schema.

## Architecture & Vision

- `docs/ARCHITECTURE.md` — current pipeline, LLM tiers, scoring, tools
- `docs/VISION.md` — product roadmap and implementation status
- `docs/DATA_MODEL.md` — table-by-table reference
- `docs/PNCP_API.md` — PNCP endpoints and DTO fields
- `README.md` — quick start and CLI reference

## Cycle 18 Boundaries

**In scope**: New schema, new CLI, new web routes, PNCP sync (procurements, plans, contracts), enrichment, chat, matching.

**Out of scope**: Legacy data migration (DB starts fresh); legacy code deletion (separate ticket 85); landing page copy; Ollama classifier; learning loop; proactive mode; deep analysis; prepare/execute workflows.
