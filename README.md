# Lixto — AI Procurement Agent

An AI agent that mirrors Brazilian public tenders (licitações) from PNCP (Portal Nacional de Contratações Públicas) into PostgreSQL, enriches them with structured insights and embeddings, and helps suppliers find and prepare competitive bids through conversational search.

## Quick Start

### Prerequisites
- **Docker & Docker Compose** (PostgreSQL 16 with pgvector)
- **uv** (Python package manager)
- **Python 3.12+**
- **Node.js 20+** (for the web interface)

### 1. Start the Database

```bash
docker compose up -d
```

Database: `lixto` on `localhost:5433` (user: `lixto`, password: `lixto`).

### 2. Initialize Schema

```bash
uv run lixto db init
```

Applies all SQL migrations. Schema name: `lixto` (v1.0, English identifiers).

### 3. Seed Reference Data

```bash
uv run lixto cnae seed
```

Fetches IBGE CNAE subclasses (industry classifications) — ~8,800 codes.

### 4. Sync Procurement Data

```bash
# Full historical backfill
uv run lixto backfill

# Incremental sync (new/updated procurements since last run)
uv run lixto sync incremental

# Detailed sync (items + documents for procurements missing them)
uv run lixto sync details

# Results (homologated winners/prices)
uv run lixto results sync

# Annual procurement plans (PCA)
uv run lixto plans sync

# Contracts + amendments
uv run lixto contracts sync
```

### 5. Enrich & Embed

```bash
# Global enrichment (once per procurement, every LLM tier routed automatically)
uv run lixto enrich run

# Backfill pgvector embeddings (for semantic search)
uv run lixto enrich embed
```

### 6. Web Interface

```bash
cd web
npm install
npm run dev
```

Opens at `http://localhost:3000`. Routes:
- `/login`, `/signup`, `/invite/[token]` — authentication
- `/company/profile` — match profile (CNAEs, products, keywords, states, value range)
- `/company/users`, `/company/documents` — team & habilitação
- `/procurements` — list/search open tenders
- `/procurement/[sourceId]` — detail, items, edital download
- `/lixto` — conversational agent; ask "quais licitações combinam com minha empresa?"
- `/dashboard` — system status

## Environment Variables

| Variable | Purpose | Example / Default |
|---|---|---|
| `LIXTO_DATABASE_URL` | PostgreSQL | `postgresql://lixto:lixto@localhost:5433/lixto` |
| `LIXTO_LLM_BASE_URL` | LLM provider base URL (OpenAI-compatible) | `https://api.openai.com/v1` |
| `LIXTO_LLM_API_KEY` | API key (fallback: `OPENAI_API_KEY`) | — |
| `LIXTO_LLM_MODEL_CHEAP` | Text classification model | `gpt-4o-mini` |
| `LIXTO_LLM_MODEL_DOC` | PDF parsing model (Responses API) | `gpt-4o` |
| `LIXTO_LLM_MODEL_STRONG` | Deep reasoning model | `gpt-4o` |
| `LIXTO_LLM_MODEL_FALLBACK` | Retry tier (optional) | — |
| `LIXTO_LLM_MODEL_EMBED` | Embedding model (1536 dims) | `text-embedding-3-small` |
| `LIXTO_CHAT_MODEL` | Chat agent model | `gpt-4o-mini` |
| `LIXTO_IBGE_CNAE_URL` | CNAE seed source | `https://concla.ibge.gov.br/export/tabelas/ascii/subclasses.txt` |
| `LIXTO_MIN_REQUEST_INTERVAL` | Seconds between PNCP requests | `0.5` |
| `UPLOADS_DIR` | Document storage path | `./web/uploads` (dev), `/app/uploads` (prod) |

## CLI Commands

### Database
- `lixto db init` — Apply all pending SQL migrations.

### Sync (incremental, resumable)
- `lixto sync incremental [--since YYYY-MM-DD] [--max-details N]` — Pull changes from PNCP's `/v1/contratacoes/atualizacao` (watermarked per modality).
- `lixto sync details [--limit N]` — Fetch items/documents for procurements missing them.

### Sync (targeted domains)
- `lixto results sync [--limit N]` — Drain the demand queue for homologated results.
- `lixto plans sync [--since YYYY-MM-DD] [--until YYYY-MM-DD]` — Fetch annual procurement plans (PCA) from `/v1/pca/atualizacao`.
- `lixto contracts sync [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--max-amendments N]` — Fetch contracts from `/v1/contratos/atualizacao` and amendments from `/v1/orgaos/{cnpj}/contratos/{ano}/{seq}/termos`.

### Backfill
- `lixto backfill [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--modality CODE ...]` — Full fetch from PNCP since a date (resumable).

### Enrichment
- `lixto enrich run [--limit N] [--days N] [--retry-errors]` — Produce one canonical enrichment per open procurement (routes to cheap/doc tier automatically).
- `lixto enrich embed [--limit N]` — Backfill pgvector embeddings for enriched procurements.

### Reference Data
- `lixto cnae seed` — Fetch IBGE CNAE subclasses and upsert (idempotent).

### Status
- `lixto status` — Print database statistics.

## Schema

**Entity layers** (see `docs/DATA_MODEL.md` for full reference):

1. **World model** — `procurements`, `procurement_items`, `procurement_documents`, `procurement_results`, `agencies`, `agency_units`
2. **Enrichment** — `procurement_enrichments`, `procurement_categories`, `procurement_requirements`, `procurement_cnaes`, `procurement_embeddings`
3. **Plans & contracts** — `procurement_plans`, `procurement_plan_items`, `contracts`, `contract_amendments`
4. **Companies** — `companies`, `company_cnaes`, `company_profiles`, `company_documents`
5. **Users & auth** — `users`, `sessions`
6. **Agent core** — `agent_runs`, `conversations`, `messages`, `opportunities`, `matches`, `recommendations`, `agent_actions`, `opportunity_feedback`
7. **Reference** — `sources`, `source_payloads`, `cnae_codes`, `sync_state`

## Production Schedules

Dokploy project `lixto`, app `lixto-cli`, timezone `America/Sao_Paulo`:

| Schedule | Cron | Command | Status |
|---|---|---|---|
| sync-incremental | `0 6,13,20 * * *` | `lixto sync incremental --max-details 2000` | Enabled |
| results-sync | `0 3 * * *` | `lixto results sync --limit 2000` | Enabled |
| plans-sync | `0 4 * * *` | `lixto plans sync` | Disabled (manual) |
| contracts-sync | `0 5 * * *` | `lixto contracts sync --max-amendments 500` | Disabled (manual) |
| enrich-run | `30 7,14,21 * * *` | `lixto enrich run --days 30 --limit 300` | Enabled |
| enrich-embed | `0 0 31 2 *` | `lixto enrich embed` | Disabled (manual) |
| db-init | `0 0 31 2 *` | `lixto db init` | Disabled (manual) |

Dates `0 0 31 2 *` (Feb 31st) never fire; use for manual-only schedules.

## Troubleshooting

### Database connection refused
```bash
docker compose ps
docker compose up -d
```

### No results after sync?
Check `lixto status` for watermarks and error counts. Verify PNCP availability with:
```bash
curl -s https://pncp.gov.br/api/swagger-ui.html
```

### LLM rate-limited?
Adjust `LIXTO_MIN_REQUEST_INTERVAL` (PNCP, not LLM) and set `LIXTO_LLM_MODEL_FALLBACK` for retry.

### Enrichment stuck?
```bash
lixto enrich run --limit 10 --retry-errors  # Reprocess failures
```

## Architecture

See `docs/ARCHITECTURE.md` for the pipeline, LLM tiers, scoring, and tools.

See `docs/VISION.md` for the product vision and implementation status.

## License

(Placeholder)
