# STATE — rewrite after every ticket completes; never append. ≤30 lines total.

## Now
- Cycle 19 (proactive agent mode) code complete: tickets 90–95 done, 1 attempt each. Main green (pytest 289, vitest 394, build). Deploying to prod; schedules match-run/recommend-run created disabled; LIXTO_INTERNAL_TOKEN set on both apps. Awaiting final diff review (2/2).

## Next
- Operator: set LIXTO_LLM_API_KEY; enable ingestion schedules when ready (sync-incremental → enrich-run → match-run → recommend-run). Rename local dir to ~/dev/lixto. Decommission legacy (separate approval).
- Cycle 20 candidates: email/push digest; prepare/execute + approval; learning from feedback; query-time semantic search; plans/contracts in matching; per-page watermark for plans sync.

## Decisions
- Cycle 19: single scoring implementation — batch match + recommendations run inside the web app behind token-guarded `/api/internal/*` routes; CLI (`lixto match run`, `lixto recommend run`) and Dokploy schedules just trigger them. Thresholds 40 (matched) / 70 (attention); GO/NO-GO cap 5/company/day; digest in-app only.
- New DB `lixto`, zero data migration incl. tenants; plural English tables; raw in `source_payloads`; facet tables; agent-core tables created, written from cycle 19.
- `vector` extension NOT trusted in pgvector image → superuser creates extensions per DB before `lixto db init` (ADR consequences).
- No prod ingestion until user re-reviews vision; all sync/enrich schedules created disabled.
- Legacy kept reachable at its site.plugu.solutions host until decommission approved; lixto.com.br moved to lixto-web.
- Dispatch: parallel worktrees ×3 worked; merge from main checkout; `cp -Rc` node_modules.
- Data pulled only from PNCP; licinexus MCP was reference only.

## Blockers
- none.
