---
id: 106
status: done
model: haiku
depends_on: [102, 103, 104, 105]
max_attempts: 3
files:
  - .env.example
  - web/.env.example
  - README.md
  - docs/ARCHITECTURE.md
  - docs/VISION.md
  - CLAUDE.md
---
## Goal
Env templates and docs describe the Gemini-first provider setup, the fence, the daily cap, cost reporting, Tier-0 ME/EPP and the go-live runbook.

## Context

Ground in code: `src/lixto/llm.py` (providers, `PRICES_USD_PER_M`, fallback env), `src/lixto/fence.py`, `src/lixto/enrich/worker.py` (`LIXTO_ENRICH_DAILY_CAP`, counters), `src/lixto/status.py`, `src/lixto/cli/backfill.py` (`--days`), `web/lib/agent/embed.ts`.

`.env.example` + `web/.env.example`: document (commented, with the prod values as examples):
```
LIXTO_LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/
LIXTO_LLM_API_KEY=            # Gemini key
LIXTO_LLM_MODEL_CHEAP=gemini-2.5-flash-lite
LIXTO_LLM_MODEL_DOC=gemini-2.5-flash
LIXTO_LLM_MODEL_STRONG=gemini-2.5-flash
LIXTO_LLM_MODEL_EMBED=gemini-embedding-001
LIXTO_CHAT_MODEL=gemini-2.5-flash
LIXTO_RECOMMEND_MODEL=gemini-2.5-flash
LIXTO_LLM_FALLBACK_BASE_URL=https://api.openai.com/v1
LIXTO_LLM_FALLBACK_API_KEY=   # OpenAI key
LIXTO_LLM_FALLBACK_MODEL_CHEAP=gpt-5-mini
LIXTO_LLM_FALLBACK_MODEL_DOC=gpt-5-mini
LIXTO_LLM_FALLBACK_MODEL_STRONG=gpt-5.1
LIXTO_FENCE_PORTALS=Compras.gov.br,ECustomize Consultoria em Software S.A,IPM Sistemas
LIXTO_FENCE_MODALITIES=6,8
LIXTO_FENCE_OPEN_ONLY=1
LIXTO_ENRICH_DAILY_CAP=1500
```
(web needs only the LLM/chat/recommend/embed vars — no fence/cap.)

`README.md`: "Go-live runbook" section: set env on lixto-cli + lixto-web → `lixto backfill --days 45 --max-details 0` (one-off, resumable) → `lixto enrich run` until `daily cap reached` → enable schedules in order sync-incremental → enrich-run → enrich-embed → match-run → recommend-run → `lixto status` shows cost. Mention embeddings model must never change without re-embedding everything.

`docs/ARCHITECTURE.md`: "Cost fence" subsection (fence env, cap, counters, `lixto status` block); LLM strategy section updated to Gemini primary / OpenAI fallback, PDF via chat completions `file` parts, embeddings 1536 dims; Tier-0 ME/EPP from `benefit_type_id`.

`docs/VISION.md` appendix: add "Cycle 21 — Cost-fenced go-live (built)" block; move "Enable prod ingestion schedules" out of the roadmap.

`CLAUDE.md`: env table gains `LIXTO_FENCE_*`, `LIXTO_ENRICH_DAILY_CAP`, `LIXTO_LLM_FALLBACK_*`; schedules note updated ("enabled in cycle 21").

## Checks (run in order — cheapest first)
1. `grep -q "LIXTO_ENRICH_DAILY_CAP" .env.example && grep -q "LIXTO_FENCE_PORTALS" .env.example && grep -q "LIXTO_LLM_FALLBACK_API_KEY" .env.example`
2. `grep -q "generativelanguage.googleapis.com" web/.env.example`
3. `grep -q "Go-live runbook" README.md && grep -q "backfill --days 45" README.md`
4. `grep -q "Cycle 21" docs/VISION.md && grep -q "Cost fence" docs/ARCHITECTURE.md && grep -q "LIXTO_ENRICH_DAILY_CAP" CLAUDE.md`

## Done when
- Env templates + README/ARCHITECTURE/VISION/CLAUDE.md match the shipped code.

## Not included
- Setting the real env in Dokploy, running the backfill, enabling schedules (orchestrator steps after this ticket).
- DATA_MODEL.md (no schema change).
