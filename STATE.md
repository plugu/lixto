# STATE — rewrite after every ticket completes; never append. ≤30 lines total.

## Now
- Cycle 31 (cache + query hygiene, **mvp**): 174–181 done, approved 2 of 2, pushed as `7850d08` (autoDeploy web + cli). Prod verification pending.
- Cycle 30 (case agent V1): deployed; concierge check on real GO case still pending.

## Next
- Post-deploy success demo (manual): read-only prod EXPLAIN on match/Radar FTS predicates; one sync run logs `cache: revalidated sync`.
- Carry-over: 167 (static shell ADR for `/`, `Vary: Cookie`); 162 review follow-ups; DMARC tighten; CNAE cleanup; Gemini billing; Radar schedules OFF; `analyze-run` OFF; restart `plugu-clientes-db-1`.

## Decisions
- Execution: sequential, in place, on `main` (same as cycle 30).
- Cache: in-process memo (`web/lib/cache.ts`, tags `sync`/`match`, TTL 900 s, single-flight), not Next `unstable_cache`/`"use cache"`.
- Invalidation: `lixto sync incremental` ends with a best-effort `POST /api/internal/cache/revalidate`; never changes exit code.
- Pool: `statement_timeout` 60 s default, `max` 10 default, both env-driven.
- No schema change this cycle; Radar embedding preservation deferred.
- pg-shared tuned 2026-09-25: 6 GiB / 3 CPU, shared_buffers 1536MB (step B applied + postgres-deploy).

## Blockers
- None.
