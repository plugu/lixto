---
id: 105
status: doing
model: sonnet
depends_on: [102]
max_attempts: 3
files:
  - src/lixto/status.py
  - tests/test_status.py
---
## Goal
`lixto status` shows the active fence, today's enrichment count vs cap, and today's LLM tokens + estimated USD.

## Context

`src/lixto/status.py`: `get_status(conn) -> StatusReport` (dataclass) + `format_status(report) -> str`; queries run on a plain cursor. Ticket 102 writes `agent_runs.counters` keys `llm_calls`, `llm_prompt_tokens`, `llm_completion_tokens`, `llm_est_usd_micros`, `cap`, `cap_reached` on runs with `kind='enrich'`. Ticket 101 provides `lixto.fence.get_fence().describe()`. `tests/test_status.py` does not exist — create it with a mocked cursor (`fetchone`/`fetchall` side effects in call order, like `tests/test_enrich_worker.py`).

Add to `StatusReport`: `fence: str`, `enrich_daily_cap: int`, `enriched_today: int`, `enriched_today_errors: int`, `llm_today: dict[str,int]` (`calls`, `prompt_tokens`, `completion_tokens`, `est_usd_micros`), `llm_last_7d_est_usd_micros: int`, `fenced_pending: int`.

Queries:
- enriched today: `SELECT count(*), count(*) FILTER (WHERE status='error') FROM procurement_enrichments WHERE enriched_at >= date_trunc('day', now())`
- llm today / 7d: `SELECT coalesce(sum((counters->>'llm_calls')::bigint),0), ... prompt, completion, est_usd_micros FROM agent_runs WHERE kind='enrich' AND started_at >= date_trunc('day', now())` and the same with `now() - interval '7 days'` for `est_usd_micros` only.
- fenced pending: count of open/upcoming procurements inside the fence without an enrichment row (`get_fence().sql("p")`).
- cap from env `LIXTO_ENRICH_DAILY_CAP` (0 = unlimited).

`format_status` appends a block:
```
enrichment:
  fence: <describe()>
  today: <n> enriched (<e> errors) / cap <cap or unlimited>
  pending in fence: <n>
  llm today: <calls> calls, <prompt> prompt + <completion> completion tokens, est US$ <x.xxxx>
  llm last 7 days: est US$ <x.xx>
```

## Checks (run in order — cheapest first)
1. `uv run ruff check src tests && uv run ruff format --check src tests`
2. `uv run pytest tests/test_status.py -q`
3. `uv run pytest -q`

## Done when
- `format_status` output contains `fence:`, `today: ... / cap 1500`, and `est US$` lines with values from the mocked queries.

## Not included
- Web dashboard for cost.
- Alerts / notifications.
