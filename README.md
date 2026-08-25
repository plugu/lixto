# plataforma-licitante — PNCP Ingestion Agent

A standalone agent that mirrors Brazilian public tenders (licitações) from PNCP (Portal Nacional de Contratações Públicas) into a local PostgreSQL database, keeping it fresh on a schedule.

## Prerequisites

- **Docker & Docker Compose** (for the PostgreSQL container)
- **uv** (Python package manager, https://docs.astral.sh/uv/getting-started/)
- **Python 3.12+**

## Quick Start

### 1. Start the Database

```bash
docker compose up -d
```

This starts a PostgreSQL 15 container on `localhost:5433` with:
- User: `plic`
- Password: `plic`
- Database: `plic`

### 2. Initialize the Database

```bash
uv run plic db init
```

This applies all SQL migrations and creates the schema.

### 3. Run the Full Backfill

```bash
uv run plic backfill
```

This pulls every licitação published on PNCP since 2026-01-01, including all line items and edital/anexo metadata. Runs at ~2 req/s (tunable via `PLIC_MIN_REQUEST_INTERVAL`, seconds between requests) and may take several hours. It is resumable — if interrupted, re-run and it continues where it stopped.

To limit the backfill for testing:
- `uv run plic backfill --until 2026-02-01` (backfill through Feb only)
- `uv run plic backfill --modalidade 1 --until 2026-01-15` (single modalidade, short date range)

> **Scheduling does not run here.** The CLI ships no scheduler of its own, by
> design — every recurring job runs on the VPS against production. See
> [Scheduling (production)](#scheduling-production). Run `plic sync` locally
> only when you deliberately want a one-off against your dev database.

## Dashboard

A local web dashboard (Next.js) for searching and inspecting licitações — list view with palavra-chave/portal/modalidade/status filters, plus a detail page with itens and edital/anexo links. Lives in `web/`.

Requires the DB up (`docker compose up -d`) and initialized (`uv run plic db init`) with at least some data synced.

```bash
cd web
npm install
npm run dev
```

Opens at `http://localhost:3000`. It reads `PLIC_DATABASE_URL` (defaults to `postgresql://plic:plic@localhost:5433/plic`, matching the Docker Compose DB above).

## Multi-Tenant (Cycle 7)

The dashboard now supports multi-tenant company profiles. See [`docs/TENANT.md`](docs/TENANT.md) for the full architecture.

**Key environment variables:**
- `PLIC_DATABASE_URL` — PostgreSQL connection (default: `postgresql://plic:plic@localhost:5433/plic`).
- `UPLOADS_DIR` — Document storage path (default: `./uploads`; production: `/app/uploads` volume).

## LLM Configuration (Cycle 16)

The enrichment worker and chat interface use a tiered LLM strategy: cheap models for text/structured analysis, doc tier for PDFs, strong tier reserved for complex reasoning. All environment variables are read by the `cli` container (Python); `web` also reads `PLIC_CHAT_MODEL`.

**Environment variables:**
- `PLIC_LLM_BASE_URL` — LLM provider base URL (e.g., an OpenAI-compatible gateway; defaults to OpenAI if unset).
- `PLIC_LLM_API_KEY` — API key for the provider. Falls back to `OPENAI_API_KEY` if unset.
- `PLIC_LLM_MODEL_CHEAP` — Cheap text model for enrichment classification, triage, etc. (default: `gpt-5-mini`). Read by `cli` and `web`.
- `PLIC_LLM_MODEL_DOC` — Doc tier for PDF input via Responses API (default: `gpt-5.1`, OpenAI only). Read by `cli`.
- `PLIC_LLM_MODEL_STRONG` — Strong model for deep reasoning (default: `gpt-5.1`). Read by `cli`.
- `PLIC_LLM_MODEL_FALLBACK` — Optional; if set, buys one retry on this model when the primary tier fails. Read by `cli`.
- `PLIC_CHAT_MODEL` — Chat model for the Lixto agent (default: `gpt-5-mini`). Read by `web`.

## CLI Commands

### Database
- `plic db init` — Apply all pending SQL migrations.

### Sync
- `plic sync publicacao --data-inicial YYYY-MM-DD --data-final YYYY-MM-DD` — Page PNCP's publicacao endpoint and upsert.
- `plic sync detalhes [--limit N]` — Fetch items and edital/anexo metadata for licitações missing them.
- `plic sync incremental [--since YYYY-MM-DD] [--max-detalhes N]` — Incremental sync from each modalidade's watermark (scheduled in production, see below).
- `plic sync resultados [--limit N]` — Fetch homologated results (winner + unit price) for itens queued by the dashboard.

### Enrichment
- `plic enrich run [--limit N] [--days N] [--retry-errors]` — Produce one canonical enrichment per open licitação (globally, reused by all empresas). Routes each row to the cheapest LLM tier: text → cheap, PDF → doc, structured only → cheap. Resumable; only rows with no prior enrichment are processed (set `--retry-errors` to reprocess failures).

#### Demand-Driven Results Queue

The results queue is populated when a user opens a licitação on the dashboard — the `item.resultados_solicitados_em` timestamp is set. The `plic sync resultados` command drains this queue in FIFO order and stamps `item.resultados_sincronizados_em` when done (set even when PNCP publishes no result, so items are not retried forever).

There is no mass backfill because a full crawl of the ~4.06M homologated items would take ~23 days at PNCP's ~2 req/s rate limit. In production a Dokploy schedule runs `sync resultados --limit 2000` (~17 minutes) nightly at 03:00 BRT — the widest observed gap between incremental runs, so the two crawls do not compete for PNCP's rate limit.

Measured 2026-08-24: one dashboard page view on a 74-item licitação enqueued ~1700 itens, and ~43% of matched historical itens turn out to have a published resultado. At 2000/night the queue can fall behind heavy browsing — raise the limit or add a second daily run before assuming the feature is broken.

### Other
- `plic backfill [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--modalidade ...]` — Full backfill from scratch (resumable).
- `plic status` — Print database statistics.

### CNAE matching

Commands for classifying licitações by CNAE (industry classification) using a local LLM (Ollama):

- `plic cnae seed` — Fetch the IBGE CNAE reference table and upsert (idempotent).
- `plic cnae classify [--limit N]` — Two-stage classification of pending licitações via Ollama (resumable).
- `plic cnae eval [--limit N]` — Dry-run evaluation: classify without persisting (for model comparison).

**Environment variables:**
- `PLIC_OLLAMA_URL` — Ollama API endpoint (default: `http://localhost:11434`).
- `PLIC_CNAE_MODEL` — Model name (default: `gpt-oss:20b`). Test different models by setting before running `classify` or `eval`.

**Remote Ollama (Tailscale setup):**

Host (plugu-local-m4) runs:
```bash
OLLAMA_HOST=0.0.0.0:11434 ollama serve
```

Consumer (your laptop) over Tailscale:
```bash
export PLIC_OLLAMA_URL=http://plugu-local-m4:11434
plic cnae classify
```

If the consumer goes offline, untagged licitações remain pending and retry on the next run — offline is not a fatal error.

## Scheduling (production)

Every recurring job runs on the VPS, never on a developer machine. There is no
`plic schedule` command and no local cron: `Dockerfile.cli` ends in
`sleep infinity` precisely so Dokploy schedules can `exec` into the running
`cli` container.

Schedules live in Dokploy → project `plataforma-licitante` → environment
`production` → application `cli` → Schedules. Timezone `America/Sao_Paulo`:

| name | cron | command | enabled |
|---|---|---|---|
| `sync-incremental` | `0 6,13,20 * * *` | `plic sync incremental --max-detalhes 2000` | yes |
| `enrich-run` | `30 7,14,21 * * *` | `plic enrich run --days 30 --limit 300` | yes |
| `sync-resultados` | `0 3 * * *` | `plic sync resultados --limit 2000` | yes |
| `db-init` | `0 0 31 2 *` | `plic db init` | no (manual) |
| `cnae-classify-30d` | `0 0 31 2 *` | `plic cnae seed && plic cnae classify --days 30` | no (manual) |

`0 0 31 2 *` is February 31st — a date that never arrives. It is the idiom for
"this schedule only ever runs when a human presses Run", used for the jobs that
must not fire on their own: migrations, and the CNAE classifier that depends on
an Ollama host reachable over Tailscale.

Migrations are also applied automatically on every deploy — the container's
command is `plic db init && exec sleep infinity`. The `db-init` schedule exists
to apply them without a redeploy.

The `enrich-run` schedule must be created in Dokploy on the VPS (operator step)
and requires the `cli` container to have all `PLIC_LLM_*` environment variables
set in the production environment. It runs 30 min after each `sync-incremental`,
ensuring fresh enrichments are available to the web layer.

## Intelligence Layer (Cycle 16)

The web interface now includes an AI agent (Lixto) that combines global enrichment, per-empresa profile matching, and conversational search. See [`docs/LIXTO.md`](docs/LIXTO.md) for the full architecture.

**Key endpoints and pages:**
- `/lixto` — Conversational chat interface. Natural language queries become tool calls; results show matched licitações with scores and reasons.
- `/empresa/perfil` — Match profile configuration. Set produtos, palavras-chave, exclusões, UFs, and value range. Profiles are used by the match engine to score each licitação.
- `POST /api/chat` — One turn of the agent conversation (accepts JSON with `texto`, optional `conversaId`, optional filters).
- `GET /api/chat` — Fetch one thread (`?conversaId=N`) or list all threads for the logged-in user.

Web requires `PLIC_CHAT_MODEL` and inherits `PLIC_LLM_BASE_URL` and `PLIC_LLM_API_KEY` from the environment.

## Example Queries

After backfill and at least one scheduled incremental sync, you can query the database:

### List Open Licitações (Proposal Window Active)

```sql
SELECT
    l.id_licitacao,
    l.numero_licitacao,
    l.objeto_compra,
    l.modalidade_id,
    l.orgao,
    l.uf,
    l.data_abertura,
    COUNT(i.id_item) as item_count
FROM licitacao l
LEFT JOIN item i ON l.id_licitacao = i.id_licitacao
WHERE
    l.status_id = 1  -- open
    AND l.data_abertura <= CURRENT_TIMESTAMP
    AND (l.data_encerramento IS NULL OR l.data_encerramento > CURRENT_TIMESTAMP)
    AND l.data_atualizacao_global >= '2026-01-01'
GROUP BY l.id_licitacao, l.numero_licitacao, l.objeto_compra, l.modalidade_id, l.orgao, l.uf, l.data_abertura
ORDER BY l.data_abertura DESC
LIMIT 100;
```

### List Upcoming Licitações (Proposal Window Not Yet Open)

```sql
SELECT
    l.id_licitacao,
    l.numero_licitacao,
    l.objeto_compra,
    l.modalidade_id,
    l.orgao,
    l.uf,
    l.data_abertura,
    COUNT(i.id_item) as item_count
FROM licitacao l
LEFT JOIN item i ON l.id_licitacao = i.id_licitacao
WHERE
    l.status_id = 1  -- open or pending
    AND l.data_abertura > CURRENT_TIMESTAMP
    AND l.data_atualizacao_global >= '2026-01-01'
GROUP BY l.id_licitacao, l.numero_licitacao, l.objeto_compra, l.modalidade_id, l.orgao, l.uf, l.data_abertura
ORDER BY l.data_abertura ASC
LIMIT 100;
```

### List Closed Licitações Since a Specific Date

```sql
SELECT
    l.id_licitacao,
    l.numero_licitacao,
    l.objeto_compra,
    l.modalidade_id,
    l.orgao,
    l.uf,
    l.data_encerramento,
    COUNT(i.id_item) as item_count
FROM licitacao l
LEFT JOIN item i ON l.id_licitacao = i.id_licitacao
WHERE
    l.status_id = 2  -- closed
    AND l.data_encerramento IS NOT NULL
    AND l.data_atualizacao_global >= '2026-01-01'
GROUP BY l.id_licitacao, l.numero_licitacao, l.objeto_compra, l.modalidade_id, l.orgao, l.uf, l.data_encerramento
ORDER BY l.data_encerramento DESC
LIMIT 100;
```

### Filter by State (UF) and Modalidade

```sql
SELECT
    l.id_licitacao,
    l.numero_licitacao,
    l.objeto_compra,
    l.data_abertura,
    COUNT(i.id_item) as item_count
FROM licitacao l
LEFT JOIN item i ON l.id_licitacao = i.id_licitacao
WHERE
    l.uf = 'SP'  -- São Paulo
    AND l.modalidade_id = 1  -- Adjust to desired modalidade
    AND l.data_atualizacao_global >= '2026-01-01'
GROUP BY l.id_licitacao, l.numero_licitacao, l.objeto_compra, l.data_abertura
ORDER BY l.data_abertura DESC
LIMIT 50;
```

### Get Edital Documents for a Licitação

```sql
SELECT
    d.id_documento,
    d.nome_arquivo,
    d.tipo_documento_id,
    d.link_download,
    d.data_disponibilizacao
FROM documento d
WHERE
    d.id_licitacao = <TARGET_ID_LICITACAO>
    AND d.tipo_documento_id = 2  -- Edital documents
ORDER BY d.data_disponibilizacao DESC;
```

### Full-Text Search on Objeto Compra (Portuguese)

```sql
SELECT
    l.id_licitacao,
    l.numero_licitacao,
    l.objeto_compra,
    l.data_abertura,
    COUNT(i.id_item) as item_count
FROM licitacao l
LEFT JOIN item i ON l.id_licitacao = i.id_licitacao
WHERE
    to_tsvector('portuguese', l.objeto_compra) @@ plainto_tsquery('portuguese', 'software')
    AND l.data_atualizacao_global >= '2026-01-01'
GROUP BY l.id_licitacao, l.numero_licitacao, l.objeto_compra, l.data_abertura
ORDER BY l.data_abertura DESC
LIMIT 100;
```

## Database Schema

### Tables
- **licitacao** — Core tender metadata (ID, number, object, modalidade, status, dates, values, etc.)
- **item** — Line items (itens de compra) within each licitação.
- **documento** — Edital and annexo documents with download URLs.
- **resultado** — Homologated results per item (winner CNPJ, razão social, porte, unit price, discount, date).
- **sync_state** — Watermarks for incremental syncs (one row per modalidade).

### Views
- **v_abertas** — Open licitações (proposal window active).
- **v_futuras** — Upcoming licitações (proposal window not yet open).
- **v_encerradas** — Closed licitações.

### Indexes
- GIN index on `to_tsvector('portuguese', objeto_compra)` for full-text search.

## Logs

- Scheduled runs log to the VPS, under
  `/etc/dokploy/schedules/<schedule-appName>/<appName>-<timestamp>.log`. The
  Dokploy UI shows them per run under the schedule's deployment history.
- A `sync incremental` run exits non-zero when a modalidade fails after
  retries — that surfaces in Dokploy as a failed run on purpose, and the other
  modalidades still complete first.

## Troubleshooting

### Database connection refused?

Ensure Docker Compose is running:
```bash
docker compose ps
```

If containers are not running:
```bash
docker compose up -d
```

### Backfill taking too long?

This is expected (~2 req/s, hours/days depending on data volume). You can interrupt and resume later — the backfill is resumable via `plic backfill`.

## Architecture

The agent uses:
- **PNCP API** (public, no auth) — paginated fetch of licitações by date range and modalidade.
- **PostgreSQL** — local mirror of licitações, items, and documents.
- **Typer** — CLI framework.
- **Dokploy schedules** (VPS) — all recurring jobs; the CLI has no scheduler.
- **uv** — Python package/project runner.

Runs are idempotent and resumable after failure.
