---
id: 102
status: todo
model: sonnet
depends_on: [100, 101]
max_attempts: 3
files:
  - src/lixto/enrich/worker.py
  - src/lixto/cli/enrich.py
  - tests/test_enrich_worker.py
---
## Goal
`lixto enrich run` enriches only fenced rows, stops at a hard daily cap, and records LLM tokens + estimated USD in `agent_runs.counters`.

## Context

`worker.enrich()` selects with `_SELECT_PENDING_SQL` (already open/upcoming + `--days` + `--limit`, ordered closing-soonest) and loops `enrich_one`. Ticket 101 provides `lixto.fence.get_fence()` / `Fence.sql(alias="p")`; ticket 100 provides `LlmClient.usage_summary()`.

Changes in `worker.py`:
1. **Fence.** `enrich(..., fence: Fence | None = None)`; `None` → `get_fence()`. Append `fence.sql("p")` to `_SELECT_PENDING_SQL` before `ORDER BY` (the SQL is a module constant — build it with a helper `_pending_sql(fence)`), merge fence params into the execute dict.
2. **Daily cap.** Env `LIXTO_ENRICH_DAILY_CAP` (int, 0/unset = unlimited), read in `enrich()` via `settings`-style helper inside worker (`_daily_cap()`); `_USED_TODAY_SQL = "SELECT count(*) FROM procurement_enrichments WHERE enriched_at >= date_trunc('day', now())"` (all statuses — errors cost tokens too). Effective limit = `min(limit or BATCH_LIMIT_DEFAULT, cap - used)`; when `<= 0` set `counters["cap_reached"] = 1`, log `"daily cap %d reached (%d enriched today); nothing to do"` and return without selecting. When the loop exhausts the effective limit because of the cap, also set `cap_reached = 1`. Counters gain `cap`, `used_today_at_start`.
3. **Usage counters.** After the loop: `s = llm.usage_summary()` → `counters["llm_calls"]`, `counters["llm_prompt_tokens"]`, `counters["llm_completion_tokens"]`, `counters["llm_est_usd_micros"]`; if `s["unpriced_models"]`, `counters["llm_unpriced_models"] = len(...)` and log them at WARNING. Existing keys `processed/done/error` unchanged. Return dict adds `cap_reached`, `est_usd` (float).

`cli/enrich.py` `run_cmd`: print one extra line `usage: N calls, P prompt + C completion tokens, est US$ X.XXXX` and `daily cap reached (cap N)` when applicable. Exit code unchanged.

Tests (`tests/test_enrich_worker.py`, mocked cursor pattern already there): fence SQL fragment present in executed query; cap: used=cap → no select, `cap_reached=1`; effective limit = cap−used; counters carry usage from a mocked `usage_summary()`.

## Checks (run in order — cheapest first)
1. `uv run ruff check src tests && uv run ruff format --check src tests`
2. `uv run pytest tests/test_enrich_worker.py -q`
3. `uv run pytest -q`

## Done when
- `LIXTO_ENRICH_DAILY_CAP=1500` with 1500 rows already enriched today → `enrich()` selects nothing and reports `cap_reached`.
- `agent_runs.counters` of an enrich run contains `llm_calls`, `llm_prompt_tokens`, `llm_completion_tokens`, `llm_est_usd_micros`, `cap`.

## Not included
- ME/EPP derivation (ticket 103).
- `lixto status` display (ticket 105).
- Changing `_SELECT_PENDING_SQL`'s ordering or `--days` semantics.
