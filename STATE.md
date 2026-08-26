# STATE — rewrite after every ticket completes; never append. ≤30 lines total.

## Now
- Cycle 19 (proactive agent mode, mvp): PRODUCT.md + tickets 90–95 written; awaiting plan approval (1/2).

## Next
- Operator: rename local checkout `~/dev/plataforma-licitante` → `~/dev/lixto` (memory dir pre-copied). Set `LIXTO_LLM_API_KEY` on lixto-web + lixto-cli when ready. Decide when to enable schedules (all disabled). Decommission legacy project + `plataforma-licitante_db` (separate approval).
- Cycle 19: /forge:idea proactive agent mode — batch match on new procurements → opportunities/matches → daily digest (docs/VISION.md §12). Prereq before enabling plans-sync: per-page resumable watermark (PCA ≈ 200k rows / 3 days).

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
