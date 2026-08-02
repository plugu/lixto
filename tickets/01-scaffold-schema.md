---
id: 01
status: todo
model: sonnet
depends_on: []
max_attempts: 3
files:
  - pyproject.toml
  - docker-compose.yml
  - .env.example
  - src/plic/__init__.py
  - src/plic/cli.py
  - src/plic/settings.py
  - src/plic/db.py
  - migrations/001_schema.sql
  - tests/test_migrations.py
---
## Goal
Project skeleton + Postgres schema + `plic db init` CLI that applies SQL migrations idempotently.

## Context
Python 3.12, uv, typer CLI named `plic`, psycopg3 (`psycopg[binary]`), ruff, pytest. No ORM — plain SQL. Settings from env: `PLIC_DATABASE_URL` (default `postgresql://plic:plic@localhost:5433/plic`). `docker-compose.yml` runs postgres:16 on host port 5433, user/pass/db `plic`.

Migration runner: `migrations/*.sql` applied in filename order, tracked in `schema_migrations(filename, applied_at)`; already-applied files skipped.

Migration 001 — tables per `docs/PNCP_API.md` DTO field lists (snake_case columns, `raw JSONB` on each):
- `licitacao` — PK `numero_controle_pncp TEXT`; promoted DTO columns; flattened `orgao_cnpj`, `orgao_razao_social`, `poder_id`, `esfera_id`, `unidade_codigo`, `unidade_nome`, `uf`, `municipio_nome`, `codigo_ibge`, `amparo_legal_codigo`, `amparo_legal_nome`; numerics as NUMERIC, dates TIMESTAMPTZ; plus `itens_sincronizados_em`, `arquivos_sincronizados_em` (nullable), `created_at`, `updated_at`.
- `item` — PK (`numero_controle_pncp` FK, `numero_item`).
- `documento` — PK (`numero_controle_pncp` FK, `sequencial_documento`).
- `sync_state` — `key TEXT PK`, `value JSONB`, `updated_at`.

Indexes: `uf`, `modalidade_id`, `data_publicacao_pncp`, `data_encerramento_proposta`, `orgao_cnpj`, GIN `to_tsvector('portuguese', objeto_compra)`.

Views: `v_abertas` (abertura ≤ now < encerramento), `v_futuras` (abertura > now), `v_encerradas` (encerramento < now OR encerramento IS NULL).

## Checks (run in order — cheapest first)
1. `uv run ruff check .`
2. `uv run pytest`
3. `docker compose up -d && sleep 5 && uv run plic db init && uv run plic db init && docker compose exec -T db psql -U plic -d plic -c '\dt+ licitacao' | grep licitacao`

## Done when
- `plic db init` creates all tables/indexes/views on a fresh DB and is a no-op on second run.
- Unit test covers migration ordering + skip-applied logic (against a temp schema or mocked cursor).

## Not included
- No API client, no data fetching, no scheduler, no Alembic/ORM, no CI config.
