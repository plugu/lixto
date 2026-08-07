# STATE — rewrite after every ticket completes; never append. ≤30 lines total.

## Now
idle — cycle 2 complete (07, 08, 09 all done, attempt 1/3 each); awaiting final mvp diff review

## Next
user: `cd web && npm run dev` → dashboard at localhost:3000

## Decisions
- execution: sequential (cycle 2)
- stack: Next.js 16, Tailwind v4, pg, vitest; style contract docs/WEB_STYLE.md
- 07: scaffold + list + migration 002 (portal column 1,287 distinct; item FTS GIN)
- 08: parameterized SQL builder + filters toolbar, URL-param state (37 tests)
- 09: detail page (slash-in-id handling), itens/documentos, README dashboard section
- DDL vs licitacao/item: commit statement-by-statement (deadlock vs live backfill)
- new dynamic routes need `next typegen` before bare `tsc --noEmit`

## Blockers
- none
