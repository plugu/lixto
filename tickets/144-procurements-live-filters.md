---
id: 144
status: done
model: opus
depends_on: [143]
max_attempts: 3
files:
  - web/app/(app)/procurements/page.tsx
  - web/components/filters.tsx
  - web/components/filter-chips.tsx
  - web/components/multi-select.tsx
  - web/components/procurements/results.tsx
  - web/components/procurements/results-skeleton.tsx
  - web/components/procurements/facet-toolbar.tsx
  - web/lib/procurement-url.ts
  - web/lib/procurement-url.test.ts
---
## Goal
On `/procurements`, filters apply as the user changes them (no "Aplicar"), the search box debounces, and the results table streams under the toolbar, so filtering feels instant and the sidebar never remounts.

## Context
`components/filters.tsx` (386 lines) is one `<form method="GET" action="/procurements">` holding the search input, status/modality/category/state/portal `MultiSelect` popovers (`details/summary` `Popover`), value range, "Compatível" toggle, column visibility menu, and the Aplicar button. `filter-chips.tsx` renders removable chips as links. `page.tsx` parses `searchParams` via `parseFilters` (`lib/procurement-queries.ts:117`), awaits `embedQuery(q)` (LLM call) *and* `fetchFacetCounts` *and* `fetchProcurements` before rendering. **The URL contract is frozen**: same param names (`q, portal, modality, status, kind, category, state, valueMin, valueMax, compat, page`), repeated params for multi-values, `page` reset to 1 on any filter change. `parseFilters` is not edited.

Work:
1. `web/lib/procurement-url.ts`: move `buildQueryString` from `page.tsx` here as `buildProcurementQueryString(filters, page?)` and add `useProcurementFilters()` (client hook): reads `useSearchParams()`, parses with `parseFilters`, exposes `{ filters, page, pending, setFilters(next), setPage(n) }`; `setFilters` builds the string, resets `page`, and calls `router.push` inside `startTransition`. Repeated keys (`state=SP&state=RJ`) are part of the contract, so do **not** use nuqs array parsers here (they comma-join); nuqs is only for the pill tabs (143). Test: `parseFilters(new URLSearchParams(buildProcurementQueryString(f)))` round-trips a fixture with every field, and any filter change yields no `page` param.
2. `filters.tsx`: drop the `<form>`; each control calls `setFilters(next)` from the hook inside `startTransition`; search input debounced 300 ms; toolbar shows `aria-busy` + a thin 2px `bg-accent` progress line at the top of the results while pending; delete the Aplicar button. Column visibility store unchanged. Popovers stay `details/summary`.
3. `filter-chips.tsx`: chips become buttons calling the same hook (no more link rebuilding).
4. `page.tsx`: render `Filters`/chips immediately with `total` coming from the results; move the list + pagination into `components/procurements/results.tsx` (async server component: does `embedQuery`, `fetchProcurements`, `fetchFacetCounts` in parallel *inside* it) wrapped in `<Suspense key={JSON.stringify(filters)+page} fallback={<ResultsSkeleton/>}>`. Facet counts feed the toolbar badges via `facet-toolbar.tsx` rendered inside `results.tsx` slot — pass counts down; if that forces the toolbar into Suspense, keep counts optional in `Filters` (`facetCounts?`) and show them when they arrive.
5. Keep the mobile card list and desktop table exactly as they are, just relocated.

## Checks (run in order — cheapest first)
1. `cd web && npm run lint`
2. `cd web && npx vitest run lib/procurement-url.test.ts lib/procurement-queries.test.ts`
3. `cd web && npm run build`
4. `cd web && npm test`
5. `cd web && curl -s -b lixto_session=devprobe 'localhost:3000/procurements?status=open&state=SP&modality=6' | grep -q 'aria-busy' ; curl -s -b lixto_session=devprobe 'localhost:3000/procurements?status=open' | grep -qv 'Aplicar'`

## Done when
- Toggling a status in the popover updates the URL and the table without a document reload; the page keeps scroll position; no "Aplicar" button exists.
- Deep links with every filter still parse identically (round-trip test green).

## Not included
- Radar toolbar (145); new filters; server-side query changes.
