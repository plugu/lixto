# STATE — rewrite after every ticket completes; never append. ≤30 lines total.

## Now
08-search-filters — dispatched (sonnet)

## Next
09-detail-page

## Decisions
- execution: sequential (cycle 2)
- stack: Next.js 16 (App Router, TS, Tailwind v4) in web/, pg pool, vitest
- style contract: docs/WEB_STYLE.md
- 07 done (1/3): scaffold + list page + migration 002 (portal column: 1,287 distinct; item FTS GIN)
- DDL against licitacao/item must commit statement-by-statement — AB-BA deadlock vs running backfill otherwise (see 002 comment)
- numero_controle_pncp contains `/` — links use encodeURIComponent; 09 must decode

## Blockers
- none
