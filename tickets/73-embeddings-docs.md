---
id: 73
status: doing
model: haiku
depends_on: [71, 72]
max_attempts: 3
files:
  - README.md
  - docs/LIXTO.md
---
## Goal
Document the pgvector semantic layer: env, commands, schema, scoring change, and the prod image swap.

## Context

Read `PRODUCT.md`, then the shipped code: `migrations/013_embedding.sql`, `src/plic/enrich/embed.py`, `src/plic/llm.py` (`PLIC_LLM_MODEL_EMBED`), `src/plic/cli.py` (`plic enrich embed`), `web/lib/agent/embed.ts`, `web/lib/match-engine.ts` (new bands), `docker-compose.yml`. Extend README sections and `docs/LIXTO.md` in place — do not rewrite them.

Facts: prod `pg-shared` runs `pgvector/pgvector:pg18-trixie` (pgvector 0.8.6; trixie variant chosen to keep glibc 2.41 / collation version identical to the previous `postgres:18`); local dev uses `pgvector/pgvector:pg16`; `vector` is a trusted extension so `plic db init` creates it; embedding model default `text-embedding-3-small` (1536 dims, HNSW cosine index); `plic enrich embed` backfills; profile embedding is best-effort on save; scoring: cosine ≥ 0.55 → +20 `semantico_alto`, ≥ 0.40 → +10 `semantico`; raw max now 110, clamped to 100. Remove "pgvector" from the "Not yet" list in `docs/LIXTO.md` and add "query-time semantic search" there instead. Add the `enrich-embed` backfill as a manual Dokploy schedule row (`0 0 31 2 *` idiom) → `plic enrich embed`.

## Checks (run in order — cheapest first)
1. `grep -q "plic enrich embed" README.md`
2. `grep -q "PLIC_LLM_MODEL_EMBED" README.md`
3. `grep -q "semantico_alto" docs/LIXTO.md`
4. `grep -q "pg18-trixie" docs/LIXTO.md`

## Done when
- README + docs/LIXTO.md describe the semantic layer accurately against the code.

## Not included
- Creating Dokploy schedules; landing copy.
