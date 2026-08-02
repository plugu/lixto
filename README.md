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

### 4. Install the Scheduler

```bash
uv run plic schedule install
```

This creates a macOS launchd job that runs `plic sync incremental` twice daily:
- **07:00** (7 AM)
- **19:00** (7 PM)

The job logs to `~/Library/Logs/plic-sync.log`.

To preview the generated plist without installing:
```bash
uv run plic schedule install --dry-run
```

To uninstall later:
```bash
uv run plic schedule uninstall
```

## CLI Commands

### Database
- `plic db init` — Apply all pending SQL migrations.

### Sync
- `plic sync publicacao --data-inicial YYYY-MM-DD --data-final YYYY-MM-DD` — Page PNCP's publicacao endpoint and upsert.
- `plic sync detalhes [--limit N]` — Fetch items and edital/anexo metadata for licitações missing them.
- `plic sync incremental [--since YYYY-MM-DD]` — Twice-daily incremental sync (runs via launchd scheduler).

### Other
- `plic backfill [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--modalidade ...]` — Full backfill from scratch (resumable).
- `plic status` — Print database statistics.

### Scheduler (macOS only)
- `plic schedule install [--dry-run]` — Install the launchd job.
- `plic schedule uninstall` — Uninstall the launchd job.

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
- **sync_state** — Watermarks for incremental syncs (one row per modalidade).

### Views
- **v_abertas** — Open licitações (proposal window active).
- **v_futuras** — Upcoming licitações (proposal window not yet open).
- **v_encerradas** — Closed licitações.

### Indexes
- GIN index on `to_tsvector('portuguese', objeto_compra)` for full-text search.

## Logs

- Incremental sync logs are written to `~/Library/Logs/plic-sync.log` (stdout + stderr combined).
- Check logs to diagnose any missed scheduled runs or failures.

## Troubleshooting

### Scheduler not running?

Check if it's loaded:
```bash
launchctl print gui/$UID/com.plic.sync
```

If not found, reinstall:
```bash
uv run plic schedule uninstall
uv run plic schedule install
```

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
- **launchd** (macOS) — twice-daily scheduling via StartCalendarInterval.
- **uv** — Python package/project runner.

Runs are idempotent and resumable after failure.
