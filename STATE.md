# STATE — rewrite after every ticket completes; never append. ≤30 lines total.

## Now
- Cycle 16 (intelligence layer: enrich + match + chat), mvp: tickets 63–70 all done, 1 attempt each. Integrated main green (ruff, pytest 180, tsc, vitest 592, next build). Awaiting final diff review (approval 2 of 2).

## Next
- Operator: set `PLIC_LLM_BASE_URL`/`PLIC_LLM_API_KEY`/`PLIC_LLM_MODEL_*` on Dokploy `cli`, plus `PLIC_CHAT_MODEL` on `web`; create Dokploy schedule `enrich-run` (`30 7,14,21 * * *`, `plic enrich run --days 30 --limit 300`); push → deploy; `db-init` schedule applies 010–012.
- Run `plic enrich run --limit 5` once in prod, eyeball `enriquecimento` quality; tune INSTRUCTIONS if palavras_chave too sparse.
- Cycle 17 candidates: proactive digest/notifications (Python batch match); prepare/execute + approval; learning loop; retire legacy triage/deep + company_profile.md; streaming chat.

## Decisions
- No pgvector (prod PG stock postgres:18). Match = CNAE ∩ + normalized term arrays (`&&`) + FTS; weights fixed in web/lib/match-engine.ts; max score 90.
- Match on-demand in web (no `match` table) — profile edits reflect instantly.
- LLM via OpenAI-compatible env (`PLIC_LLM_*`): Chat Completions for text tiers (portable), Responses API for PDF tier (OpenAI only). Web reuses same env + `PLIC_CHAT_MODEL` (default gpt-5-mini).
- Legacy triage/deep + company_profile.md untouched (still feed Fit badge). Chat non-streaming JSON.
- Repo-wide `ruff format --check` fails on ~16 pre-existing files; checks scoped to new files. Candidate chore: one-shot `ruff format` commit.
- Dispatch: parallel worktrees (2), `cp -Rc` node_modules, merge from main checkout — worked cleanly, zero conflicts.
- Carried: no cron on dev machine; resultados demand-driven.

## Blockers
- none.
