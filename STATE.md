# STATE — rewrite after every ticket completes; never append. ≤30 lines total.

## Now
- Cycle 17 (pgvector semantic layer) done: tickets 71–73, 1 attempt each. Main green (pytest 205, vitest 621, next build). Prod pg-shared = pgvector/pgvector:pg18-trixie (PG 18.6, pgvector 0.8.6); local = pg16-trixie. Cycle 16 + 17 unpushed (main ahead of origin).

## Next
- Operator: set `PLIC_LLM_BASE_URL`/`PLIC_LLM_API_KEY`/`PLIC_LLM_MODEL_*` on Dokploy `cli`, plus `PLIC_CHAT_MODEL` on `web`; create Dokploy schedule `enrich-run` (`30 7,14,21 * * *`, `plic enrich run --days 30 --limit 300`); push → deploy; `db-init` schedule applies 010–012.
- Run `plic enrich run --limit 5` once in prod, eyeball `enriquecimento` quality; then `plic enrich embed` to backfill vectors; re-save each empresa's /empresa/perfil so it gets an embedding.
- Cycle 18 candidates: query-time semantic search in search_procurements; proactive digest/notifications (Python batch match); prepare/execute + approval; learning loop; retire legacy triage/deep + company_profile.md; streaming chat.

## Decisions
- pgvector now available (prod image pgvector/pgvector:pg18-trixie — trixie keeps glibc 2.41 so no collation mismatch; bookworm tag briefly ran ~4 min on 2026-08-25 19:33 UTC). Match = CNAE ∩ + term arrays + FTS + cosine bands (≥0.55 +20, ≥0.40 +10).
- Match on-demand in web (no `match` table) — profile edits reflect instantly.
- LLM via OpenAI-compatible env (`PLIC_LLM_*`): Chat Completions for text tiers (portable), Responses API for PDF tier (OpenAI only). Web reuses same env + `PLIC_CHAT_MODEL` (default gpt-5-mini).
- Legacy triage/deep + company_profile.md untouched (still feed Fit badge). Chat non-streaming JSON.
- Repo-wide `ruff format --check` fails on ~16 pre-existing files; checks scoped to new files. Candidate chore: one-shot `ruff format` commit.
- Dispatch: parallel worktrees (2), `cp -Rc` node_modules, merge from main checkout — worked cleanly, zero conflicts.
- Carried: no cron on dev machine; resultados demand-driven.

## Blockers
- none.
