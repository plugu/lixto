---
id: 97
status: done
model: sonnet
depends_on: [96]
max_attempts: 3
files:
  - web/lib/agent/tools.ts
  - web/lib/agent/tools.test.ts
  - web/lib/agent/types.ts
---
## Goal
`search_procurements` embeds the free text and returns hybrid results whose refs say whether each hit came from keyword, semantic, or both.

## Context

`searchProcurements` (tools.ts ~L247) calls `fetchProcurements(filters, limit, 0)`. Change: when `filters.q` is set, `const qEmbedding = await embedQuery(filters.q)` (from `./embed`, added in ticket 96) and pass it as the 5th arg. Null embedding → keyword-only, same as today; never surface an error for it.

`ProcurementRef` (types.ts) gains optional `match_kind?: "keyword" | "semantic" | "both"`; `toRef` copies `row.match_kind` when non-null (RefSource gets the optional field). Tool result `data.items[]` therefore carries it so the model can say "encontrei por similaridade".

Update the `search_procurements` tool description (Portuguese) to say the text search is semantic — synonyms and paraphrases match even without shared words — so the model stops rewording user queries into keywords.

Tests: tools.test.ts already mocks `../procurement-queries` `fetchProcurements`; add `vi.mock("./embed", () => ({ embedQuery: vi.fn() }))`. Cases: q present → `embedQuery` called and its value passed as 5th arg; q absent → not called, 5th arg `undefined`; `embedQuery` resolves null → 5th arg null; `match_kind` copied to refs.

## Checks (run in order — cheapest first)
1. `cd web && npm run lint`
2. `cd web && npx tsc --noEmit`
3. `cd web && npx vitest run lib/agent/tools.test.ts`
4. `cd web && npm test`

## Done when
- `executeTool("search_procurements", { q: "material escolar" })` embeds once and passes the vector to `fetchProcurements`; refs include `match_kind`.

## Not included
- `search_my_matches` (already semantic via profile vector).
- Prompt changes in run.ts; streaming.
- `/procurements` page (ticket 98).
