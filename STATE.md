# STATE — rewrite after every ticket completes; never append. ≤30 lines total.

## Now
- Cycle 13 (preço-alvo) shipped to production. Commit `c08bc97`; web + cli deployed 2026-08-25 11:12; migration 009 applied in prod (`Applied 1 migration(s): 009_resultado.sql`); `sync-resultados` ran clean on demand.
- Tickets 55-59 done. Checks: ruff, 133 pytest, 368 vitest, next build, page probe 200.

## Next
- Cycle 14 candidates, in the order I'd pick them:
  1. Throughput: one page view enqueues ~1700 itens vs 2000/night drained. Raise `--limit`, lower the 40-candidate cap per item, or drain more often.
  2. `/concorrente/[cnpj]` — the `resultado` table already stores winner CNPJ, porte and unit price; the profile page is the second product the ingest was built for.
  3. Match quality: FTS+trigram is unproven at scale. If medians look wrong, embeddings are the next lever (pgvector is NOT available on the prod Postgres — checked).

## Decisions
- **no scheduling on a dev machine.** launchd module, `plic schedule` command and tests deleted. A `com.plic.sync` job was found loaded and crawling PNCP from the laptop on 2026-08-25 — uninstalled. All crons are Dokploy schedules on the `cli` app.
- prod schedules (America/Sao_Paulo): `sync-incremental` `0 6,13,20 * * *`; `sync-resultados` `0 3 * * *`; `db-init` and `cnae-classify-30d` manual-only via the Feb-31 cron idiom.
- crawl policy: demand-driven only. Full crawl of 4.06M homologated itens = ~23 days at 2 req/s.
- `resultado` = promoted columns, no `raw`. ~660 B/row measured with indexes.
- CATMAT exists on 0.25% of 7.85M itens — no catalog key. FTS retrieval + LATERAL LIMIT 200/item; 43% of matched historical itens have a published resultado.
- n<5 → percentis null in SQL. SRP losing ranks excluded.
- `/resultados` has NO pagination — `pagina` ignored, page N echoes page 1 forever. Handled by `_FirstPageOnly`.

## Blockers
- none.
