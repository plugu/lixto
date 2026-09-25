---
id: 176
status: done
model: sonnet
depends_on: []
max_attempts: 3
files:
  - src/lixto/internal_api.py
  - src/lixto/cli/sync.py
  - src/lixto/cli/cache.py
  - tests/test_internal_api.py
  - tests/test_cli_cache.py
  - tests/test_cli_sync_revalidate.py
---
## Goal
`lixto sync incremental` ends by asking the web app to drop its `sync` cache tag (even when a modality failed), and `lixto cache revalidate` exists as the manual trigger — no Dokploy schedule change needed.

## Context
The CLI already calls the web app's internal routes through `InternalApi` (`src/lixto/internal_api.py`, httpx, header `x-lixto-internal-token`, `InternalApiError` on non-2xx) using `get_web_internal_url()` / `get_internal_token()` from `src/lixto/settings.py` (`get_internal_token` raises `RuntimeError` when unset). Pattern for a thin CLI trigger: `src/lixto/cli/match.py`. CLI auto-discovery: a module in `src/lixto/cli/` exporting `name` + `app` is mounted (`tests/test_cli_discovery.py`). `incremental_cmd` in `src/lixto/cli/sync.py:38-69` runs `run_sync_incremental`, prints counters, and `raise typer.Exit(1)` when `result["modalities_failed"]` is non-empty. Route contract (ticket 175, may not be merged yet — code against the contract): `POST /api/internal/cache/revalidate`, JSON body `{"tags"?: ["sync" | "match", ...]}` (default `["sync"]`), 200 → `{"revalidated": [...], "dropped": n}`, 401 bad token, 400 unknown tag. Tests use `httpx.MockTransport` (`tests/test_internal_api.py`) and a stubbed `InternalApi` class via `monkeypatch.setattr(module, "InternalApi", stub)` (`tests/test_cli_match_recommend.py`).

### Work
1. `src/lixto/internal_api.py`: add `cache_revalidate(self, *, tags: list[str] | None = None) -> dict[str, Any]` posting `{"tags": tags}` when given, else `{}`; document it in the module docstring's contract list.
2. `src/lixto/cli/cache.py` (new): `name = "cache"`, `app = typer.Typer(help="Web cache commands")`, command `revalidate` with repeatable `--tag` (default none → server default `sync`); prints `revalidated: …` / `dropped: …`; on `(InternalApiError, httpx.HTTPError, RuntimeError)` echo `error: …` to stderr and `raise typer.Exit(code=1) from None`.
3. `src/lixto/cli/sync.py` `incremental_cmd`: after the counters line (before the failure branch), call a module-level helper `_revalidate_web_cache()` that opens `InternalApi(get_web_internal_url(), get_internal_token())`, calls `cache_revalidate()`, and echoes `cache: revalidated sync`. Any of `(InternalApiError, httpx.HTTPError, RuntimeError)` → `typer.echo(f"warning: cache revalidate failed: {exc}", err=True)` and continue; the command's exit code is decided only by `modalities_failed`, exactly as today. Import `InternalApi`/`InternalApiError`/settings getters at module top so tests can monkeypatch `sync_module.InternalApi`.
4. Tests: `tests/test_internal_api.py` — `cache_revalidate` posts the right path/header/body and surfaces 401 as `InternalApiError`. `tests/test_cli_cache.py` — prints counters; `--tag` repeat passes the list; error exits 1 without traceback. `tests/test_cli_sync_revalidate.py` — with `run_sync_incremental` and `db.get_connection` monkeypatched: (a) success → `cache_revalidate` called once, exit 0; (b) `modalities_failed` non-empty → still called once, exit 1; (c) `InternalApi` raising `RuntimeError` (token unset) → warning on stderr, exit code unchanged.

## Checks (run in order — cheapest first)
1. `uv run ruff check src tests`
2. `uv run pytest tests/test_internal_api.py tests/test_cli_cache.py tests/test_cli_sync_revalidate.py tests/test_cli_discovery.py -q`
3. `uv run lixto cache --help | grep -q revalidate`
4. `uv run pytest -q`

## Done when
- All checks green; `lixto sync incremental` always attempts the revalidate call after the sync and never changes its exit code because of it; `lixto cache revalidate` is mounted.

## Not included
- Calling revalidate from `lixto enrich embed`, `plans`, `contracts` or `results` sync (embeddings and those tables do not feed the cached aggregates); Dokploy schedule edits; README/CLAUDE.md docs (181).
