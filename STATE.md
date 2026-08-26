# STATE — rewrite after every ticket completes; never append. ≤30 lines total.

## Now
- Cycle 20 (query-time semantic search, mvp) implemented: tickets 96–99 done, 1 attempt each, main green (vitest 415, tsc, lint, next build). Commits 3a09d66..HEAD. Approved 2/2, pushed, lixto-web auto-deployed (29831ec, done 11:30Z). Dokploy enrich-embed cron set to 45 7,14,21 (disabled). Prod functional smoke pending: needs login + LIXTO_LLM_API_KEY + embedded rows.

## Next
- Prod smoke (logged in): chat "material escolar para crianças" + `/procurements?q=...` shows Similar pill (needs LIXTO_LLM_API_KEY + embedded rows).
- Operator: set LIXTO_LLM_API_KEY; enable ingestion schedules when ready (sync-incremental → enrich-run → enrich-embed → match-run → recommend-run).
- Cycle 21 candidates: email/push digest; prepare/execute + approval; learning from feedback; plans/contracts in matching; per-page watermark for plans sync.

## Decisions
- Cycle 20 dispatch: sequential in place (only 97∥98 parallelizable; worktree cost > gain).
- Cycle 20: hybrid retrieval = FTS ∪ pgvector top-200 (cosine ≥0.4), reciprocal-rank fusion k=60, structured filters hard in both branches; embedding failure → keyword-only fallback; facets stay keyword-only. No Python/schema change — `worker.py` already embeds inline, `enrich embed` backfills.
- Cycle 19: single scoring implementation — batch match + recommendations run inside the web app behind token-guarded `/api/internal/*` routes; CLI and Dokploy schedules trigger them. Thresholds 40/70; GO/NO-GO cap 5/company/day; digest in-app only.
- New DB `lixto`, zero data migration incl. tenants; plural English tables; raw in `source_payloads`; facet tables.
- `vector` extension NOT trusted in pgvector image → superuser creates extensions per DB before `lixto db init`.
- No prod ingestion until user re-reviews vision; all sync/enrich schedules created disabled.
- Legacy kept reachable at its site.plugu.solutions host until decommission approved; lixto.com.br moved to lixto-web.
- Data pulled only from PNCP; licinexus MCP was reference only.

## Blockers
- none.
