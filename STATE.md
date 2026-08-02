# STATE — rewrite after every ticket completes; never append. ≤30 lines total.

## Now
02-client-publicacao — dispatched (sonnet)

## Next
03-detalhes → 04-backfill → 05-incremental → 06-scheduler-docs

## Decisions
- execution: sequential
- git repo initialized at run start; commit after each ticket
- 01 done (attempt 1/3): uv+typer+psycopg3 scaffold, migrations runner, schema v1, docker postgres:16@5433
- db helper: `plic.db.get_connection()`; migrations resolve from repo root

## Blockers
- none
