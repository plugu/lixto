---
id: 89
status: done
model: haiku
depends_on: [86]
max_attempts: 4
files:
  - .env.example
  - web/.env.example
  - README.md
---
## Goal
Env examples and README match the code defaults.

## Context
Reviewer findings 8 and 12. Ground truth: `src/lixto/llm.py` (defaults: `LIXTO_LLM_MODEL_CHEAP=gpt-5-mini`, `MODEL_DOC=gpt-5.1`, `MODEL_STRONG=gpt-5.1`, `MODEL_EMBED=text-embedding-3-small` — 1536 dims, must match `vector(1536)`; `LIXTO_LLM_BASE_URL` unset = OpenAI), `src/lixto/settings.py`, `src/lixto/pncp_client.py` (`LIXTO_MIN_REQUEST_INTERVAL` default), `web/lib/agent/llm.ts` + `web/lib/agent/embed.ts` (`LIXTO_LLM_API_KEY`/`OPENAI_API_KEY`, `LIXTO_LLM_BASE_URL`, `LIXTO_CHAT_MODEL`, `LIXTO_LLM_MODEL_EMBED`), `web/lib/db.ts`, `web/lib/uploads.ts`.
- Root `.env.example`: replace the Ollama-style values (`nomic-embed-text`, `mistral`, `localhost:11434`) with the code defaults (commented), keep every variable the code reads, add a comment that the embedding model must produce 1536 dims.
- `web/.env.example`: add `LIXTO_LLM_API_KEY`, `LIXTO_LLM_BASE_URL`, `LIXTO_CHAT_MODEL`, `LIXTO_LLM_MODEL_EMBED`.
- README env table: fix model names and the `LIXTO_MIN_REQUEST_INTERVAL` default to the code's values.

## Checks (run in order — cheapest first)
1. `! grep -n "nomic\|mistral\|11434\|gpt-4o" .env.example web/.env.example README.md`
2. `grep -q LIXTO_CHAT_MODEL web/.env.example && grep -q LIXTO_LLM_MODEL_EMBED web/.env.example`
3. `grep -q "text-embedding-3-small" .env.example README.md`

## Done when
- Copying `.env.example` values verbatim yields a working OpenAI-backed setup with 1536-dim embeddings.

## Not included
- Code changes.
