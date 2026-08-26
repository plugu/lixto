# STATE — rewrite after every ticket completes; never append. ≤30 lines total.

## Now
- Cycle 18 (Lixto core from zero) complete: tickets 74–89 done, reviewer pass done, infra cutover done. Prod: Dokploy project `lixto` (lixto-web `QKzjW7QHbZrY6rYeVUBfm`, lixto-cli `VT5kg8t3WKXuH9J7lbCaZ`), DB `lixto` on pg-shared (35 tables, cnae_codes seeded, no other data), domains lixto.com.br + www + lixto.site.plugu.solutions. Legacy project still up at plataforma-licitante.site.plugu.solutions (autoDeploy off). Awaiting final approval 3/3.

## Next
- Operator: rename local checkout `~/dev/plataforma-licitante` → `~/dev/lixto` (memory dir pre-copied). Set `LIXTO_LLM_API_KEY` on lixto-web + lixto-cli when ready. Decide when to enable schedules (all disabled). Decommission legacy project + `plataforma-licitante_db` (separate approval).
- Cycle 19: /forge:idea proactive agent mode — batch match on new procurements → opportunities/matches → daily digest (docs/VISION.md §12). Prereq before enabling plans-sync: per-page resumable watermark (PCA ≈ 200k rows / 3 days).

## Decisions
- New DB `lixto`, zero data migration incl. tenants; plural English tables; raw in `source_payloads`; facet tables; agent-core tables created, written from cycle 19.
- `vector` extension NOT trusted in pgvector image → superuser creates extensions per DB before `lixto db init` (ADR consequences).
- No prod ingestion until user re-reviews vision; all sync/enrich schedules created disabled.
- Legacy kept reachable at its site.plugu.solutions host until decommission approved; lixto.com.br moved to lixto-web.
- Dispatch: parallel worktrees ×3 worked; merge from main checkout; `cp -Rc` node_modules.
- Data pulled only from PNCP; licinexus MCP was reference only.

## Blockers
- none.
