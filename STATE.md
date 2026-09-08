# STATE — rewrite after every ticket completes; never append. ≤30 lines total.

## Now
- Cycle 25 (AI Tender Analysis V1, **mvp**) running in worktree `cycle-24-tender-analysis`. tickets 131–136 all done (1 attempt each). Suites green: ruff, pytest 473, tsc, vitest 494, next build. Merged to main (fast-forward, ee11ec7) and pushed 2026-09-08 09:32 UTC; GitHub-App autoDeploy built lixto-web (09:34) and lixto-cli (09:35, `lixto db init` on start). Dokploy: `enrich-run` renamed `analyze-run` (command updated, still DISABLED — cost decision from cycle 21 stands), new `analyze-jobs` `*/2 * * * *` `lixto analyze jobs --limit 5` ENABLED (id OtyQLv5h1SmUvWb5DAbl3). New env vars left at defaults.

## Next
- Verify migration 006 applied on prod (first `analyze-jobs` run log, or psql `schema_migrations`); smoke-test "Analisar com IA" on one open procurement in prod; `analyze-run` cron stays DISABLED by decision (2026-09-08): analysis is on-demand only via "Analisar com IA".
- Radar session (other Claude, main checkout on `cycle-24-radar`) must now rebase onto ee11ec7 — expect conflicts in CLAUDE.md/README/ARCHITECTURE/DATA_MODEL/status.py; its `005_radar.sql` numbering is fine (006 already taken).

## Decisions
- execution: sequential (in place, this worktree)
- Radar is being implemented CONCURRENTLY by another session on branch `cycle-24-radar` in the MAIN checkout (tickets 124–130 code complete, owns `005_radar.sql` and the name "cycle 24"). This work is therefore **cycle 25**, migration `006_tender_analysis.sql`. Merge order: Radar first, then rebase/merge this branch; expect conflicts in CLAUDE.md, README, ARCHITECTURE, DATA_MODEL, `status.py`.
- One deep pass replaces `enrich run`; facet tables kept (match/search/recommend untouched); dossier in new tables (`migrations/006_tender_analysis.sql`).
- `LIXTO_ENRICH_DAILY_CAP` name kept for the cron cap; on-demand jobs bypass it, capped per company (`LIXTO_ANALYZE_USER_DAILY_CAP`). Cron `analyze-run` deliberately disabled — do not enable without the user.
- Document-set hash = one SQL (`md5(string_agg(...))`) shared verbatim by Python and TS.
- Cycle 23 shipped (b76a205 + earlier); cycle 22 closed 2026-09-04.

## Blockers
- none.
