# STATE — rewrite after every ticket completes; never append. ≤30 lines total.

## Now
04-backfill — dispatched (sonnet)

## Next
05-incremental → 06-scheduler-docs

## Decisions
- execution: sequential
- git repo initialized at run start; commit after each ticket
- 01 done (1/3): scaffold, migrations, schema v1, docker postgres@5433
- 02 done (1/3): pncp_client + publicacao sync, freshness upsert; probe idempotent
- 03 done (1/3): sync_detalhes (itens+arquivos, 204 = end of pagination), item schema matched live API, no migration 002
- detalhes refetches itens+arquivos together per licitação (mvp shortcut, documented)

## Blockers
- none
