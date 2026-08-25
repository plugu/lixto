---
id: 74
status: todo
model: opus
depends_on: []
max_attempts: 4
files:
  - migrations/001_core.sql
  - legacy/migrations/**
  - src/lixto/__init__.py
  - src/lixto/settings.py
  - src/lixto/db.py
  - src/lixto/runs.py
  - src/lixto/pncp_client.py
  - src/lixto/cli/__init__.py
  - src/lixto/cli/db.py
  - tests/lixto/__init__.py
  - tests/lixto/test_db.py
  - tests/lixto/test_runs.py
  - tests/lixto/test_pncp_client.py
  - tests/lixto/test_cli_discovery.py
  - pyproject.toml
  - uv.lock
  - docker-compose.yml
  - Dockerfile.cli
---
## Goal
The `lixto` Python package exists with the new database schema, migration runner, PNCP HTTP client, run logging and an auto-discovering CLI — the foundation every other ticket builds on.

## Context

Read `PRODUCT.md` and **`docs/adr/001-lixto-data-model.md`** (the DDL there is the contract — ship it verbatim). Legacy package `src/plic` stays in the repo until ticket 85 (other tickets port from it); do not modify it. New tests live under `tests/lixto/` (mocked psycopg/httpx, same style as `tests/test_pncp_client.py`, `tests/test_migrations.py`).

### Schema + migrations
- `git mv migrations legacy/migrations` (legacy `plic` never runs again; `tests/test_migrations.py` uses tmp dirs so it keeps passing).
- New `migrations/001_core.sql` = ADR DDL verbatim, with a 3-line header comment pointing at the ADR.

### `src/lixto`
- `settings.py`: `get_database_url()` → `LIXTO_DATABASE_URL`, default `postgresql://lixto:lixto@localhost:5433/lixto`.
- `db.py`: port of `src/plic/db.py` (plain-SQL runner, `schema_migrations` table, `get_connection`, `run_migrations`, `list_migration_files` reading `migrations/` at repo root — path resolved relative to the package like the legacy did).
- `runs.py`: `@contextmanager run(conn, kind: str, company_id: int | None = None)` — inserts an `agent_runs` row (`status='running'`), yields a `RunCounters` object (dict-like, `.inc(key, n=1)`), on normal exit updates `status='done', finished_at=now(), counters=<json>`, on exception updates `status='failed', error=str(exc)[:2000]` and re-raises. Commits its own updates. Every CLI command from later tickets wraps its work in this.
- `pncp_client.py`: port of `src/plic/pncp_client.py` unchanged in behaviour (rate-limit policy, retries, 204 handling, `_FirstPageOnly` semantics live in the results ticket) — same public API renamed to English where trivial (`fetch_publication_page`, `fetch_update_page`, `fetch_items`, `fetch_documents`, `fetch_item_results`, `iter_publication_pages`, `iter_update_pages`) **plus** new methods the domain tickets need: `fetch_plans_update_page(date_from, date_to, page, page_size=50)` → `/api/consulta/v1/pca/atualizacao` (params `dataInicio`, `dataFim`, `pagina`, `tamanhoPagina`; envelope `PaginaRetornoPlanoContratacaoComItensDoUsuarioDTO`); `fetch_contracts_page(date_from, date_to, page, page_size=50, updated=False)` → `/api/consulta/v1/contratos` or `/contratos/atualizacao` (`dataInicial`, `dataFinal`); `fetch_contract_amendments(agency_tax_id, year, sequence)` → `/api/pncp/v1/orgaos/{cnpj}/contratos/{ano}/{sequencial}/termos` (bare array, paged like `/itens`, 204 ends). Dates are `yyyyMMdd`. Tests for each new method (mocked httpx transport: params, envelope parsing, 204 → empty).
- `cli/__init__.py`: `app = typer.Typer(help="lixto — AI procurement agent")`; **auto-discovery**: `pkgutil.iter_modules(lixto.cli.__path__)`, import each submodule, and for every module exposing `app: typer.Typer` and `name: str` call `root.add_typer(module.app, name=module.name)`; a module exposing `command: typer.Typer` with `name` is mounted the same way. Top-level commands (e.g. `status`, `backfill`) are registered by a module exposing `register(root)`. Document this contract in the module docstring — later tickets add one file each, never edit this one. Entry point `main()`.
- `cli/db.py`: `name = "db"`, `app` with `init` (`run_migrations`, prints applied files) — port of `plic db init`.

### Packaging / runtime
- `pyproject.toml`: `name = "lixto"`, packages `["src/plic", "src/lixto"]` (both until 85), scripts `lixto = "lixto.cli:main"` and keep `plic` for now; deps unchanged (`pypdf` already present). Run `uv lock`.
- `docker-compose.yml`: db image `pgvector/pgvector:pg16-trixie`, `POSTGRES_USER/PASSWORD/DB = lixto`, port `5433:5432`, volume `lixto_pgdata`.
- `Dockerfile.cli`: unchanged layout, CMD `lixto db init && exec sleep infinity`.

### Tests
`tests/lixto/test_db.py` (runner ordering/idempotence with mocks), `test_runs.py` (done/failed paths, counters json), `test_pncp_client.py` (ported + new endpoints), `test_cli_discovery.py` (a fake module in a temp package is discovered and mounted).

## Checks (run in order — cheapest first)
1. `uv run ruff check src/lixto tests/lixto`
2. `uv run ruff format --check src/lixto tests/lixto`
3. `uv run pytest -q`
4. `uv run lixto --help | grep -q '^ *db'`
5. `docker compose down -v && docker compose up -d db && sleep 5 && uv run lixto db init` prints `Applied 1 migration(s): 001_core.sql`; `docker compose exec -T db psql -U lixto -Atc "select count(*) from information_schema.tables where table_schema='public'"` prints `35` (34 ADR tables + `schema_migrations`); `docker compose exec -T db psql -U lixto -Atc "select extversion from pg_extension where extname='vector'"` prints a version.

## Done when
- Fresh local `lixto` DB has all 34 tables from the ADR, `lixto db init` is idempotent, `lixto --help` lists `db`.
- `PncpClient` new methods hit the documented PNCP URLs with `yyyyMMdd` dates (asserted in tests).

## Not included
- Any sync/enrich logic (75–79), web changes (80–82), deleting `src/plic` (85).
- Seeding `cnae_codes` (79).
