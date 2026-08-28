---
id: 100
status: doing
model: opus
depends_on: []
max_attempts: 3
files:
  - src/lixto/llm.py
  - tests/test_llm.py
---
## Goal
`LlmClient` runs on Gemini's OpenAI-compatible endpoint with a per-call cross-provider fallback, reads PDFs through chat completions instead of the Responses API, pins embeddings to 1536 dims, and accumulates token usage + estimated USD.

## Context

`src/lixto/llm.py` today: one `OpenAI` client from `LIXTO_LLM_BASE_URL`/`LIXTO_LLM_API_KEY`, tiers `MODEL_CHEAP/DOC/STRONG/EMBED`, `MODEL_FALLBACK` = a second *model name on the same client*; `complete_json_pdf` uses `client.responses.create` with `input_file` (OpenAI-only); `embed` calls `embeddings.create` without `dimensions`. Tests mock the SDK object (`tests/test_llm.py` `_client`, `_llm` helpers) — keep that style.

Change:
1. **Two providers.** `build_client(prefix="LIXTO_LLM")` reads `{prefix}_BASE_URL` / `{prefix}_API_KEY` (primary keeps the `OPENAI_API_KEY` fallback for the key). Fallback provider = `LIXTO_LLM_FALLBACK_BASE_URL`, `LIXTO_LLM_FALLBACK_API_KEY`, `LIXTO_LLM_FALLBACK_MODEL_CHEAP/DOC/STRONG` (all optional; fallback active only when `LIXTO_LLM_FALLBACK_API_KEY` set). Constructor gains `fallback_client: OpenAI | None` and `fallback_cheap/doc/strong` names. Semantics unchanged: exactly one retry on SDK exception or unusable JSON, now on the fallback client + that tier's fallback model. Keep `LIXTO_LLM_MODEL_FALLBACK` working as before when no fallback provider is configured (same-client retry) so existing tests pass. Embeddings never fall back.
2. **PDF via chat completions.** `complete_json_pdf` builds `messages=[system, user]` where user content = `[{"type":"file","file":{"filename":..., "file_data":"data:application/pdf;base64,..."}}, ..., {"type":"text","text":prompt}]`, `response_format` json_schema strict, model = doc tier; same fallback rule as text (fallback doc model). Remove `_responses_text` and the Responses API path.
3. **Embeddings dims.** `embeddings.create(model=..., input=batch, dimensions=EMBED_DIMS)`; reject vectors whose length != 1536 with `ValueError`.
4. **Usage.** Every chat/embeddings response's `usage` (prompt_tokens/completion_tokens, or `prompt_tokens`/`total_tokens` for embeddings) accumulates into `self.usage: dict[str, dict[str,int]]` keyed by model: `{calls, prompt_tokens, completion_tokens}`. Add `PRICES_USD_PER_M: dict[str, tuple[float,float]]` (input, output per 1M tokens) for: `gemini-2.5-flash-lite` (0.10, 0.40), `gemini-2.5-flash` (0.30, 2.50), `gemini-embedding-001` (0.15, 0), `gpt-5-mini` (0.25, 2.00), `gpt-5.1` (1.25, 10.00), `gpt-5` (1.25, 10.00), `text-embedding-3-small` (0.02, 0). `estimated_usd() -> float` sums usage × prices; unknown model → 0 and listed in `unpriced_models()`. `usage_summary() -> dict` returns `{"calls","prompt_tokens","completion_tokens","est_usd_micros"(int), "unpriced_models"}` for `RunCounters`.
5. Module defaults stay OpenAI names (env decides provider); add `CLIENT_TIMEOUT` unchanged.

Tests to add: fallback provider used on exception (different client object called); PDF path builds `file` content parts and `json_schema`; `dimensions=1536` passed; wrong-dims raises; usage accumulates across calls and `estimated_usd` matches hand math; unknown model → unpriced.

## Checks (run in order — cheapest first)
1. `uv run ruff check src tests && uv run ruff format --check src tests`
2. `uv run pytest tests/test_llm.py -q`
3. `uv run pytest -q`

## Done when
- `LlmClient(client=A, fallback_client=B, ...)`: A raises → B called with fallback model; B never called when A succeeds.
- `complete_json_pdf` never touches `client.responses`.
- `embed` passes `dimensions=1536`; `usage_summary()` reports tokens + `est_usd_micros`.

## Not included
- Worker/CLI changes (ticket 102 consumes `usage_summary()`).
- Web (TypeScript) embeddings dims (ticket 104).
- `.env.example` docs (ticket 106).
