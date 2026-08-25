# STATE — rewrite after every ticket completes; never append. ≤30 lines total.

## Now
- Cycle 16 (enrich + match + chat), mvp. Done: 63, 64, 65, 66, 67 (all 1 attempt). 68 (chat runtime, opus) running in place.

## Next
- 69 (chat UI, sonnet) → 70 (docs, haiku) sequential in place, then mvp final diff review (approval 2 of 2).
- Post-cycle operator steps: set PLIC_LLM_* env on Dokploy `cli` + `web`, create `enrich-run` schedule.

## Decisions
- Dispatch: parallel worktrees, 2 concurrent, `../plataforma-licitante-wt/<id>` branch `forge/<id>`; node_modules copied with `cp -Rc` (Turbopack symlink gotcha); merge from main checkout.
- No pgvector this cycle (prod PG stock postgres:18). Match = CNAE ∩ + normalized term arrays + FTS.
- Match engine on-demand in web (no `match` table); Python batch deferred to proactive cycle.
- Scoring weights fixed in ticket 66; LLM via OpenAI-compatible env (`PLIC_LLM_*`), Chat Completions for text tiers, Responses API for PDF tier.
- Legacy triage/deep + company_profile.md untouched; chat non-streaming JSON.
- Carried: no cron on dev machine; resultados demand-driven.

## Blockers
- none. Note: repo-wide `ruff format --check` fails on 17 pre-existing files; checks scoped to new files (tickets 63/64).
