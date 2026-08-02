# STATE — rewrite after every ticket completes; never append. ≤30 lines total.

## Now
03-detalhes — dispatched (sonnet)

## Next
04-backfill → 05-incremental → 06-scheduler-docs

## Decisions
- execution: sequential
- git repo initialized at run start; commit after each ticket
- 01 done (1/3): scaffold, migrations, schema v1, docker postgres@5433
- 02 done (1/3): pncp_client (throttle+retry, injectable transport), publicacao sync + freshness upsert; real probe 111 rows idempotent
- upsert NULLs `*_sincronizados_em` on real update → 03's refetch signal
- httpx added to deps (required, was missing from ticket files list)

## Blockers
- none
