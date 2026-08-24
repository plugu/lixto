---
id: 51
status: todo
model: sonnet
depends_on: [50]
max_attempts: 3
files:
  - src/plic/cnae_match.py
  - src/plic/cli.py
  - tests/test_cnae_match.py
---
## Goal
Two-stage Ollama routine that tags each pending aberta/futura licitação with CNAE subclasses into `licitacao_cnae`, resumable and offline-tolerant.

## Context
Clone the structure of `src/plic/classify.py` (batch select → Ollama OpenAI-compat `/v1/chat/completions` → tolerant JSON parse → commit per batch). New module `cnae_match.py`:

- Select: same predicate as classify but `cnae_classificado_em IS NULL`; fetch `left(objeto_compra,300)` + top-5 item descriptions (100 chars each).
- **Stage 1 (per batch of 10):** prompt lists all divisions (`SELECT DISTINCT divisao, divisao_descricao FROM cnae ORDER BY divisao` — ~87 lines); model returns per row up to 4 division codes.
- **Stage 2 (per licitação):** prompt lists subclasses of its chosen divisions (`codigo — descricao`); model returns array of `{"codigo": "1234567", "confidence": 0.0-1.0}`. Validate codigo against the fetched subclass set; drop unknowns.
- Persist: insert `licitacao_cnae` rows (`ON CONFLICT DO NOTHING`) and stamp `cnae_classificado_em = now()` — stamp even when zero tags, so the row leaves the queue. On HTTP/connection error: log, abort the run with the row unstamped — next run retries (Ollama host may be an offline laptop; unavailability is never fatal data-wise, exit code may be nonzero).
- Env: reuse `PLIC_OLLAMA_URL`; model from `PLIC_CNAE_MODEL` (default `gpt-oss:20b`); temperature 0.
- CLI: `plic cnae classify --limit N` on the `cnae` sub-app from ticket 50.

Tests mirror `tests/test_classify.py`: prompt builders, parse/validate both stages, orchestration with mocked httpx client + mocked conn (offline error leaves row unstamped; empty stage-2 still stamps).

## Checks (run in order — cheapest first)
1. `uv run ruff check`
2. `uv run pytest tests/test_cnae_match.py`
3. `uv run pytest`

## Done when
- `plic cnae classify --limit 5` against a live DB + reachable Ollama fills `licitacao_cnae` and stamps rows; rerun selects only unstamped rows.
- Ollama unreachable → no rows stamped, command exits without corrupting state.

## Not included
- Per-item tagging, re-classification of updated licitações, historical backfill.
- Scheduling/cron wiring and model eval (ticket 53).
- Cloud LLM fallback.
