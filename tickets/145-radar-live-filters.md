---
id: 145
status: done
model: sonnet
depends_on: [144]
max_attempts: 3
files:
  - web/app/(app)/radar/page.tsx
  - web/components/radar/filter-toolbar.tsx
  - web/components/radar/results.tsx
  - web/components/radar/results-skeleton.tsx
  - web/lib/radar-url.ts
  - web/lib/radar-url.test.ts
---
## Goal
`/radar` filters (UF, período, valor mín/máx, aderência mín) apply on change with a pending state, and the card list streams under the headline, matching the procurements page from ticket 144.

## Context
`app/(app)/radar/page.tsx` has a `<form method="GET">` toolbar with selects/inputs + Aplicar, a hidden `view` input, and awaits `fetchRadarList`, `fetchRadarSummary`, `fetchRadarStateOptions` together. Contract (`parseRadarFilters`, `lib/radar-list-queries.ts`) is frozen: `view, state (repeated), period, minValue, maxValue, minScore, page`. Move the page's `buildQueryString` to `web/lib/radar-url.ts` as `buildRadarQueryString` and add `useRadarFilters()` following the exact pattern of `lib/procurement-url.ts` (ticket 144): `useSearchParams` + `router.push` + `useTransition`, page reset on change. Test round-trip through `parseRadarFilters`. **Learned in 144**: a client hook cannot import `lib/radar-list-queries.ts` (module-scope pg `Pool`), so write a client twin `parseRadarSearchParams(URLSearchParams)` in `lib/radar-url.ts` and keep it honest with an equivalence test table against the real `parseRadarFilters` (see `lib/procurement-url.ts` / `.test.ts` for the exact pattern, incl. `searchParamsToRecord`). `useTransition` pending is per component: the pending indicator lives in the component that calls `setFilters`.

`components/radar/filter-toolbar.tsx` (client): same controls, no form, no Aplicar, selects apply immediately, number inputs apply on blur/Enter or after 400 ms idle; `aria-busy` + accent progress line while pending. The headline (`summary.total_value` sentence) stays above and is fetched by the page; `results.tsx` (async server) fetches the list and renders cards + `Pagination`; wrapped in `<Suspense key=…>` with `results-skeleton.tsx`. `PillTabs` from 143 remains for `view`; drop the hidden input.

## Checks (run in order — cheapest first)
1. `cd web && npm run lint`
2. `cd web && npx vitest run lib/radar-url.test.ts lib/radar-list-queries.test.ts`
3. `cd web && npm run build`
4. `cd web && npm test`
5. `cd web && curl -s -b lixto_session=devprobe 'localhost:3000/radar?period=90&state=SP' | grep -qv 'Aplicar'`

## Done when
- Changing "Período" updates URL + cards with no document reload; deep links unchanged.

## Not included
- Radar detail page; new filters; scoring.
