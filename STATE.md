# STATE — rewrite after every ticket completes; never append. ≤30 lines total.

## Now
- Cycle 16 (intelligence layer: enrich + match + chat), mvp. Wave 1 running: 63 (enrich schema + doc text, opus) ∥ 65 (perfil match, sonnet) in worktrees.

## Next
- Wave 2: 64 (enrich worker) ∥ 66 (match engine web) after 63+65 merge.
- Then 67 → 68 → 69 → 70 sequential in place.

## Decisions
- Dispatch: parallel worktrees, 2 concurrent, `../plataforma-licitante-wt/<id>` branch `forge/<id>`; node_modules copied with `cp -Rc` (Turbopack symlink gotcha); merge from main checkout.
- No pgvector this cycle (prod PG stock postgres:18). Match = CNAE ∩ + normalized term arrays + FTS.
- Match engine on-demand in web (no `match` table); Python batch deferred to proactive cycle.
- Scoring weights fixed in ticket 66; LLM via OpenAI-compatible env (`PLIC_LLM_*`), Chat Completions for text tiers, Responses API for PDF tier.
- Legacy triage/deep + company_profile.md untouched; chat non-streaming JSON.
- Carried: no cron on dev machine; resultados demand-driven.

## Blockers
- none.
