# STATE — rewrite after every ticket completes; never append. ≤30 lines total.

## Now
09-detail-page — dispatched (sonnet)

## Next
finish: mvp diff review (approval 2 of 2)

## Decisions
- execution: sequential (cycle 2)
- stack: Next.js 16 in web/, pg pool, vitest; style contract docs/WEB_STYLE.md
- 07 done (1/3): scaffold + list + migration 002 (portal column, item FTS)
- 08 done (1/3): queries.ts SQL builder (parameterized), filters toolbar, URL-param state
- DDL vs licitacao/item: commit statement-by-statement (deadlock vs backfill)
- numero_controle_pncp contains `/` — 09 must decode route param

## Blockers
- none
