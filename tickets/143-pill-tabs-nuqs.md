---
id: 143
status: done
model: sonnet
depends_on: [142]
max_attempts: 3
files:
  - web/components/ui/pill-tabs.tsx
  - web/components/dashboard/breakdown-section.tsx
  - web/app/(app)/opportunities/page.tsx
  - web/app/(app)/radar/page.tsx
  - web/lib/url-state.ts
  - web/lib/url-state.test.ts
---
## Goal
Every pill-tab group (dashboard chart scope, opportunities view, radar view) updates the URL client-side with a visible pending state instead of a hard link, while server pages keep reading the same `searchParams`.

## Context
Three places render the same pill markup as `<Link>` rows: `breakdown-section.tsx` (`?scope=open|upcoming|all`, default `open`, `parseChartScope`), `opportunities/page.tsx` (`?view=attention|all|dismissed`, default `attention`), `radar/page.tsx` (`?view=all|saved|ignored`, default `all`, other filters preserved via `buildQueryString`).

Build `web/components/ui/pill-tabs.tsx` (client): `PillTabs({ param, options: {value,label}[], defaultValue, ariaLabel })`. Uses `useQueryState(param, parseAsStringLiteral(values).withDefault(defaultValue).withOptions({ shallow: false, history: "push", clearOnDefault: true }))` from `nuqs` plus `useTransition`; `startTransition(() => setValue(v))`. Because `shallow:false`, the server page re-renders with the new `searchParams` (Suspense/loading fallbacks from 141/142 apply). Markup: the existing pill classes (`rounded-[9999px] px-3 py-1 text-[13px] font-medium`, active `bg-ink text-surface`, inactive `bg-surface-raised text-ink-muted hover:bg-line/60 hover:text-ink`) as `<button role="tab" aria-selected>` inside `<div role="tablist" aria-label>`; while `isPending` the tablist gets `aria-busy` and the *target* pill `opacity-60`; arrow keys move between tabs. `clearOnDefault` keeps `/opportunities` (no `?view=`) as the canonical URL for the default, matching today's links.

`web/lib/url-state.ts` exports the three literal option arrays + defaults (`CHART_SCOPES`, `OPPORTUNITY_VIEWS`, `RADAR_VIEWS`) so page parsers and `PillTabs` share one source; `url-state.test.ts` asserts defaults and that the page parsers (`parseChartScope`, opportunities `parseView`, `parseRadarFilters().view`) accept exactly those values. Replace the three `<Link>` pill rows with `<PillTabs>`; radar keeps its `<input type="hidden" name="view">` in the filter form until 145.

## Checks (run in order — cheapest first)
1. `cd web && npm run lint`
2. `cd web && npx vitest run lib/url-state.test.ts`
3. `cd web && npm run build`
4. `cd web && npm test`

## Done when
- Clicking "Todas" on /opportunities changes the URL to `/opportunities?view=all` without a document reload, the clicked pill dims until the list arrives, back button returns to "Atenção".

## Not included
- Filter toolbars (144, 145); pagination links.
