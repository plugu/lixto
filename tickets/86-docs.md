---
id: 86
status: doing
model: haiku
depends_on: [85]
max_attempts: 4
files:
  - README.md
  - docs/ARCHITECTURE.md
  - docs/DATA_MODEL.md
  - docs/LIXTO.md
  - docs/VISION.md
  - docs/PNCP_API.md
  - AGENTS.md
  - CLAUDE.md
---
## Goal
Documentation describes Lixto as it now is: new repo name, CLI, schema, env, schedules, PNCP endpoints incl. PCA and contracts.

## Context

Read `PRODUCT.md`, `docs/adr/001-lixto-data-model.md`, and the shipped code (`src/lixto/cli/*.py` for commands, `migrations/001_core.sql`, `web/app/(app)` routes, `.github/workflows/deploy.yml`). Ground every statement in code.

- `README.md`: rewrite for Lixto — quick start (compose, `lixto db init`, `lixto cnae seed`, `lixto backfill`, `lixto sync incremental|details`, `lixto results sync`, `lixto plans sync`, `lixto contracts sync`, `lixto enrich run|embed`, `lixto status`), env table (`LIXTO_*`), web routes, Dokploy schedules table (from ticket 84), troubleshooting. Keep it short; deep detail goes to docs.
- `docs/ARCHITECTURE.md`: replaces `docs/LIXTO.md` (delete the old file): pipeline (PNCP → sync → source_payloads/procurements → document texts → enrichment → facets + embeddings → match (on demand) → tools → chat), LLM tiers + env, scoring table (English reason codes), tools, agent-core tables and which cycle writes them, "not yet" list.
- `docs/DATA_MODEL.md`: table-by-table reference generated from the ADR (purpose, key, notable indexes) + the legacy→new naming map.
- `docs/PNCP_API.md`: add the PCA and contracts/amendments endpoints with params, envelopes, DTO fields (from tickets 77/78) and the 204 behaviours.
- `docs/VISION.md`: appendix status table updated (plans, contracts, agent-core tables now exist; remaining "not built" list).
- Root `AGENTS.md`/`CLAUDE.md` (create if absent): one screen for coding agents — package layout, CLI discovery contract, env names, "read ADR before touching schema".

## Checks (run in order — cheapest first)
1. `grep -q "lixto plans sync" README.md && grep -q "lixto contracts sync" README.md && grep -q "LIXTO_DATABASE_URL" README.md`
2. `test -f docs/ARCHITECTURE.md && ! test -f docs/LIXTO.md && test -f docs/DATA_MODEL.md`
3. `grep -q "pca/atualizacao" docs/PNCP_API.md && grep -q "termos" docs/PNCP_API.md`
4. `! grep -rn "plic\b\|plataforma-licitante\|PLIC_" README.md docs`

## Done when
- A new developer can set up, sync, enrich and run the web app from README alone; docs match the code.

## Not included
- Landing copy; infra.
