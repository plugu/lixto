---
id: 20
status: done
model: sonnet
depends_on: []
max_attempts: 3
files:
  - scripts/seed_open.sh
---
## Goal
A script that copies only open/future licitações (and their dependent rows) from one Postgres to another, so the freshly provisioned VPS database starts with ~14k relevant rows instead of 611k.

## Context
Schema (`migrations/001_schema.sql`, `006_analise.sql`): `licitacao` (PK `numero_controle_pncp`), `item` and `documento` (FK `numero_controle_pncp` → licitacao), `analise` (PK/FK `numero_controle_pncp`), `sync_state` (key/value watermarks, PK `key`). Five tables total.

"Open or future" predicate (same as `src/plic/classify.py:56`):
`data_encerramento_proposta >= now() OR data_abertura_proposta > now()`.

Script `scripts/seed_open.sh` (bash, `set -euo pipefail`), usage:
```
SRC_URL=postgresql://... DST_URL=postgresql://... scripts/seed_open.sh [--dry-run]
```
- URLs come from env, never argv. `--dry-run` prints row counts per table from SRC and exits.
- Target must already have migrations applied (script checks `schema_migrations` has 6 rows in DST, else exit 2 with message "run `plic db init` against DST first").
- Streams with `psql "$SRC_URL" -c "\copy (SELECT ...) TO STDOUT"` piped into `psql "$DST_URL" -c "\copy <table> FROM STDIN"`, in FK order: `licitacao`, `item`, `documento`, `analise`, then `sync_state` (all rows). Use a temp table or the predicate inline as a subquery for dependents: `WHERE numero_controle_pncp IN (SELECT numero_controle_pncp FROM licitacao WHERE <predicate>)`. Select `*` with explicit column order is unnecessary since both sides share the same migrations.
- Idempotence: wrap the DST side in one transaction; before each `\copy FROM`, nothing is deleted — instead DST must be empty: script checks `SELECT count(*) FROM licitacao` on DST is 0, else exits 3 ("DST not empty; refusing to seed").
- Print per-table row counts copied at the end.

Local source for the check: `postgresql://plic:plic@localhost:5433/plic`. For the check, create a scratch target DB on the same local instance: `docker compose exec -T db psql -U plic -d plic -c "CREATE DATABASE plic_seedtest"` then apply migrations with `PLIC_DATABASE_URL=postgresql://plic:plic@localhost:5433/plic_seedtest uv run plic db init`. Drop it after.

`psql` client: use `docker compose exec -T db psql` if no local `psql` binary (then the script should accept a `PSQL` env override, default `psql`; for the check set `PSQL="docker compose exec -T db psql"` and use `host.docker.internal`-free URLs since it runs inside the db container: `postgresql://plic:plic@localhost:5432/plic`).

The live run against the VPS (provisioning via `~/dev/vps-infra/scripts/provision-db.sh`, tunnel, `plic db init`, then this script) is executed by the orchestrator with user confirmation — not by this ticket.

## Checks (run in order — cheapest first)
1. `bash -n scripts/seed_open.sh && shellcheck scripts/seed_open.sh` (skip shellcheck if not installed; say so)
2. `SRC_URL=postgresql://plic:plic@localhost:5433/plic DST_URL=postgresql://plic:plic@localhost:5433/plic scripts/seed_open.sh --dry-run | grep -q licitacao`
3. Full seed into `plic_seedtest` (created + migrated as described), then `psql "$DST_URL" -tc "select count(*) from licitacao where not (data_encerramento_proposta >= now() or data_abertura_proposta > now())"` prints `0`, and `select count(*) from licitacao` prints a number > 10000.
4. Re-run step 3's seed against the populated `plic_seedtest` → exit code 3.
5. Cleanup: `DROP DATABASE plic_seedtest`.

## Done when
- Script seeds a migrated empty DB with only open/future licitações + dependents + sync_state, refuses non-empty targets, and reports counts.

## Not included
- No VPS access, no provisioning, no Dockerfiles, no Python changes.
