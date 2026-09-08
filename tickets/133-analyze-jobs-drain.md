---
id: 133
status: done
model: sonnet
depends_on: [132]
max_attempts: 3
files:
  - src/lixto/analyze/jobs.py
  - src/lixto/cli/analyze.py
  - src/lixto/status.py
  - src/lixto/enrich/__init__.py
  - tests/test_analyze_jobs.py
  - tests/test_status.py
---
## Goal
`lixto analyze jobs` drains the on-demand `analysis_jobs` queue: each queued job runs `analyze_one` for its procurement (fence and global daily cap bypassed) and ends `done` or `error`.

## Context
Cycle 25 (PRODUCT.md): the web app inserts `analysis_jobs` rows (`status='queued'`, ticket 134) when a user clicks "Analisar com IA"; a Dokploy schedule runs this command every 2 minutes on `lixto-cli`. Table DDL is in `migrations/006_tender_analysis.sql` (ticket 131); the worker API is `lixto.analyze.worker.analyze_one(conn, row, *, llm, http_client)` from ticket 132, where `row` is one record of the worker's `_SELECT_PENDING_SQL` shape (id, source_id, description, additional_info, modality_name, state, city_name, estimated_value, proposal_closes_at, proposal_opens_at, published_at, is_price_registry, agency_name).

### `src/lixto/analyze/jobs.py`
- `_CLAIM_SQL`: `UPDATE analysis_jobs SET status='running', started_at=now() WHERE id = (SELECT id FROM analysis_jobs WHERE status='queued' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING id, procurement_id` — one claim per loop iteration, committed immediately, so two overlapping schedule runs never take the same job.
- `_SELECT_ROW_SQL`: the procurement row for `analyze_one`, by `p.id` (copy the SELECT list of the worker's pending SQL, joined to `agencies`, no fence, no open/closed filter — an operator may re-run a closed one on purpose).
- `_FINISH_SQL`: `UPDATE analysis_jobs SET status=%(status)s, error=%(error)s, finished_at=now() WHERE id=%(id)s`.
- `drain_jobs(conn, *, limit=None, llm=None, http_client=None, counters=None) -> dict`: loop up to `limit` (default 20): claim → no row = stop → fetch procurement row (missing → finish `error='licitação não encontrada'`) → `analyze_one` → finish with `done`/`error` (the worker's persisted `tender_analyses.error`, or `None`). Counters `processed/done/error` + `_apply_usage` like the worker (import it). Any exception around a single job marks that job `error` with `str(exc)[:2000]` and continues.
- Stale `running` rows (a crashed previous run) are re-queued at the start of every drain: `UPDATE analysis_jobs SET status='queued', started_at=NULL WHERE status='running' AND started_at < now() - interval '30 minutes'`.

### Follow-ups from ticket 132 (small, same lane)
- `src/lixto/status.py`: `_LLM_TODAY_SQL` and `_LLM_LAST_7D_SQL` still filter `agent_runs.kind = 'enrich'`; runs are now recorded as `'analyze'` (cron) and `'analyze_jobs'` (this ticket). Change both to `kind IN ('analyze', 'analyze_jobs')` and update `tests/test_status.py` accordingly (assert the SQL text mentions both kinds).
- `src/lixto/enrich/__init__.py`: the docstring still mentions the deleted `worker.py`; reword to describe what the package holds now (`documents.py`, `schema.py` facet contract, `embed.py`) and point to `lixto.analyze` for the worker.

### CLI
Add `@app.command("jobs")` to `src/lixto/cli/analyze.py`: `--limit`, `runs.run(conn, "analyze_jobs")`, prints `jobs: N processed (done D, error E)` + the usage line; exit code 0 even when all errored (a bad edital must not fail the schedule), but print the error count to stderr when `done == 0 and error > 0`.

Tests (`tests/test_analyze_jobs.py`, mocked psycopg + `analyze_one` monkeypatched): claim/finish SQL sequence, stop when no job, error path marks job, stale requeue SQL runs first, `limit` honoured, CLI output via `CliRunner`.

## Checks (run in order — cheapest first)
1. `uv run ruff check src tests && uv run ruff format --check src tests`
2. `uv run pytest -q tests/test_analyze_jobs.py tests/test_analyze_worker.py tests/test_status.py tests/test_cli_discovery.py`
3. `uv run pytest -q`
4. `uv run lixto analyze jobs --help | grep -q -- --limit && ! grep -n "kind = 'enrich'" src/lixto/status.py && ! grep -n "worker.py" src/lixto/enrich/__init__.py`

## Done when
- With one `analysis_jobs` row inserted by hand on the dev DB (`INSERT INTO analysis_jobs (procurement_id, company_id) VALUES (...)`), `uv run lixto analyze jobs` marks it `done`, and `tender_analyses` has the dossier for that procurement.

## Not included
- Enqueue logic, per-company cap, or any web code (ticket 134).
- Notifying the user when the job finishes (the page polls).
- Schedule creation in Dokploy / docs (ticket 136).
