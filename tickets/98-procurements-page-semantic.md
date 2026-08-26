---
id: 98
status: todo
model: sonnet
depends_on: [96]
max_attempts: 3
files:
  - web/app/(app)/procurements/page.tsx
  - web/components/procurement-card.tsx
  - web/components/filters.tsx
---
## Goal
The `/procurements` search box uses the same hybrid retrieval as the chat and marks rows found by meaning rather than by keyword.

## Context

`page.tsx` (~L48–68): after `parseFilters`, if `filters.q` do `const qEmbedding = await embedQuery(filters.q)` (from `@/lib/agent/embed`, ticket 96) — run it in the same `Promise.all` batch as `getCompanyCnaes` is not possible (needs no session), so await it before the `Promise.all` that calls `fetchProcurements`, and pass it as the 5th arg: `fetchProcurements(filters, PAGE_SIZE, offset, companyCnaes, qEmbedding)`. `fetchFacetCounts` stays unchanged (facets keyword-only). Null embedding → keyword-only, identical to today.

Show provenance: rows now carry `match_kind` (`"keyword" | "semantic" | "both" | null`). When `match_kind === "semantic"` render a small muted pill "Similar" next to the agency line — in the mobile `ProcurementCard` (procurement-card.tsx, near `row.agency_name`) and in the desktop table's first `ColTD` in page.tsx. Reuse the existing pill styling from `StatusBadge`'s neighbours (`text-xs`, `rounded`, `bg-*-soft` tokens used elsewhere in the component tree); no new component file. `"keyword"`/`"both"`/null render nothing.

filters.tsx L252: placeholder becomes `"Buscar por objeto, órgão ou descreva o que você vende…"`.

Empty-state hint unchanged.

## Checks (run in order — cheapest first)
1. `cd web && npm run lint`
2. `cd web && npx tsc --noEmit`
3. `cd web && npm test`
4. `cd web && npm run build`

## Done when
- `/procurements?q=material+escolar` calls `embedQuery` once and passes the vector to `fetchProcurements`; rows with `match_kind === "semantic"` show the "Similar" pill in both layouts.

## Not included
- Facet counts on the semantic candidate set.
- A toggle to disable semantic search.
- Any change to procurement-queries.ts (ticket 96) or chat tools (ticket 97).
