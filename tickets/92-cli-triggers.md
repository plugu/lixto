---
id: 92
status: doing
model: sonnet
depends_on: []
max_attempts: 3
files:
  - src/lixto/settings.py
  - src/lixto/internal_api.py
  - src/lixto/cli/match.py
  - src/lixto/cli/recommend.py
  - tests/test_internal_api.py
  - tests/test_cli_match_recommend.py
  - .env.example
---
## Goal
`lixto match run` and `lixto recommend run` trigger the web app's internal batch endpoints so operators and Dokploy schedules keep a single CLI surface.

## Context

Read `PRODUCT.md`. Scoring lives in the web app (single implementation); the CLI is a thin HTTP client. Contract (tickets 90/91, may not be merged yet — code against it): `POST {LIXTO_WEB_INTERNAL_URL}/api/internal/match/run` and `/api/internal/recommend/run`, header `x-lixto-internal-token: {LIXTO_INTERNAL_TOKEN}`, JSON body `{ "companyId"?: int, "since"?: ISO string }` / `{ "companyId"?: int, "limit"?: int }`, response `200 {runId, companies, scored, matched, attention}` / `200 {runId, companies, recommended, skipped_cap, failed}`; 401 on bad token; 500 `{error}`. CLI discovery contract: module exposes `name` + `app` (see `src/lixto/cli/__init__.py` docstring). Tests mock `httpx` (`httpx.MockTransport`) like `tests/test_pncp_client.py`.

- `settings.py`: `get_web_internal_url()` → `LIXTO_WEB_INTERNAL_URL` (default `http://localhost:3000`), `get_internal_token()` → `LIXTO_INTERNAL_TOKEN` (required; clear error if unset).
- `internal_api.py`: `InternalApi(base_url, token, timeout=600)` with `match_run(company_id=None, since=None)` and `recommend_run(company_id=None, limit=None)` returning the parsed JSON; raises `InternalApiError` with status + body on non-2xx.
- `cli/match.py` (`name="match"`): `run [--company-id N] [--since YYYY-MM-DD]` prints the counters one per line, exit 1 on error. `cli/recommend.py` (`name="recommend"`): `run [--company-id N] [--limit N]`.
- `.env.example`: add `LIXTO_WEB_INTERNAL_URL` (prod value `http://lixto-web-evs842:3000` — the Dokploy service name on `dokploy-network`) and `LIXTO_INTERNAL_TOKEN` (same value on web and cli).

## Checks (run in order — cheapest first)
1. `uv run ruff check src tests && uv run ruff format --check src tests`
2. `uv run pytest -q`
3. `uv run lixto match run --help | grep -q -- --since && uv run lixto recommend run --help | grep -q -- --limit`
4. `LIXTO_INTERNAL_TOKEN=x LIXTO_WEB_INTERNAL_URL=http://127.0.0.1:9 uv run lixto match run; test $? -eq 1` (connection error → exit 1, no traceback spew: one-line message).

## Done when
- `lixto match run` against a running web (ticket 90) prints the counters; a wrong token prints `401` and exits 1.

## Not included
- Any scoring in Python; scheduling (operator creates Dokploy schedules, disabled).
