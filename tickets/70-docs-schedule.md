---
id: 70
status: doing
model: haiku
depends_on: [64, 69]
max_attempts: 3
files:
  - README.md
  - docs/LIXTO.md
---
## Goal
Document the cycle-16 intelligence layer (enrichment worker, profile, match engine, chat) and how it is operated in production.

## Context

Read `PRODUCT.md` and tickets 63–69 (the receipts describe what actually shipped — document that, not the plan). README sections that already exist and must be extended in place: "CLI Commands", "Environment variables", the Dokploy schedules table (`sync-incremental`, `sync-resultados`, `db-init`, `cnae-classify-30d`) and the deploy notes. Keep the existing tone (short, imperative, tables).

### README.md

- CLI: add `plic enrich run [--limit N] [--days N] [--retry-errors]` with a one-line description (global enrichment, one row per licitação, reused by every empresa).
- Env vars: `PLIC_LLM_BASE_URL`, `PLIC_LLM_API_KEY` (fallback `OPENAI_API_KEY`), `PLIC_LLM_MODEL_CHEAP`, `PLIC_LLM_MODEL_DOC`, `PLIC_LLM_MODEL_STRONG`, `PLIC_LLM_MODEL_FALLBACK`, `PLIC_CHAT_MODEL` — mark which are read by `cli` (Python) vs `web` (Next).
- Schedules table: add a row `enrich-run` · `30 7,14,21 * * *` · `plic enrich run --days 30 --limit 300` · enabled (runs 30 min after each `sync-incremental`). State explicitly that the schedule is created in Dokploy on the VPS (no local cron — see the existing note), and that the `cli` container needs the `PLIC_LLM_*` env set in Dokploy.
- Web: mention `/lixto` (chat), `/empresa/perfil` (match profile), `POST /api/chat`.

### `docs/LIXTO.md`

One page, in the style of `docs/TENANT.md`: pipeline diagram (PNCP → sync → `documento_texto` → `enriquecimento` → match engine (on demand, web) → tools → chat), tables listing the new tables and their purpose (`enriquecimento`, `documento_texto`, `empresa_perfil`, `conversa`, `mensagem`), the LLM tier routing (Tier 0 deterministic, Tier 1 cheap text, Tier 2 PDF, Tier 3 strong — with the env var that selects each), the scoring rule from ticket 66 verbatim as a table (motivo code → peso), the five tools, and a "Not yet" list (proactive digest, prepare/execute, learning loop, pgvector — prod Postgres is stock `postgres:18` without the extension).

## Checks (run in order — cheapest first)
1. `grep -q "plic enrich run" README.md`
2. `grep -q "enrich-run" README.md`
3. `grep -q "PLIC_LLM_BASE_URL" README.md`
4. `test -f docs/LIXTO.md && grep -q "me_epp_exclusivo" docs/LIXTO.md`

## Done when
- A new developer can, from README alone, set the env, run `plic enrich run`, configure a profile and use `/lixto`.

## Not included
- Creating the Dokploy schedule itself or touching `.github/workflows/deploy.yml` (operator step; the deploy workflow already redeploys `cli` on `src/**` changes).
- Landing-page copy (`web/components/marketing/*`).
