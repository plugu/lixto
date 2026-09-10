---
id: 142
status: done
model: sonnet
depends_on: [141]
max_attempts: 3
files:
  - web/app/(app)/dashboard/page.tsx
  - web/components/dashboard/today-section.tsx
  - web/components/dashboard/kpi-tiles.tsx
  - web/components/dashboard/status-section.tsx
  - web/components/dashboard/daily-section.tsx
  - web/components/dashboard/breakdown-section.tsx
  - web/components/dashboard/skeletons.tsx
---
## Goal
`/dashboard` paints its header and "Oportunidades de hoje" first and streams the rest section by section, ordered as an answer hierarchy: is anything worth my attention → how big is the pipeline → detail charts.

## Context
Today `web/app/(app)/dashboard/page.tsx` awaits five queries in one `Promise.all` before any pixel, and lays out seven sections flat with the chart scope pills floating *between* charts. Refactor into async server components under `web/components/dashboard/`, each doing its own fetch, each wrapped by the page in `<Suspense fallback={...}>` with a fallback from `skeletons.tsx` (built on `@/components/ui/skeleton`, same box sizes as the real section, so no layout shift):

1. `TodaySection({ companyId })` — `getDigest`; digest banner copy + the three attention cards (existing `OpportunityCard`) + "Ver todas" action. Rendered **outside** Suspense (it is the answer; page awaits it).
2. `KpiTiles()` — `fetchStatusCounts`; the four `StatTile`s.
3. `StatusSection({ counts })` — reuse counts from KpiTiles by making `KpiTiles` render both tiles and `StatusStack` (one fetch); keep the file split for the fallbacks.
4. `DailySection()` — `fetchByDay` → `DailyLine`.
5. `BreakdownSection({ scope })` — `fetchByModality(scope)` + `fetchByPortal(scope)` → two `BarList`s side by side. The scope pills move into this section's `Section` header `actions` slot; keep them as plain `Link`s for now (ticket 143 swaps them for `PillTabs`) and keep the `?scope=` contract via `parseChartScope`.

Page = `PageHeader title="Visão geral"` (ticket 141) + those sections in that order, `gap-10`. `export const dynamic = "force-dynamic"` stays. Each section component takes only serialisable props; no client components except the existing charts.

## Checks (run in order — cheapest first)
1. `cd web && npm run lint`
2. `cd web && npm run build`
3. `cd web && npm test`
4. `cd web && curl -sN -b lixto_session=devprobe -D - localhost:3000/dashboard | head -c 20000 | grep -q 'data-skeleton'` (dev server + local DB; proves streaming with fallbacks in the first bytes)

## Done when
- First paint shows header + today section while charts stream in; scope pills sit in the "por modalidade/portal" section header.
- No query is executed twice per request (counts fetched once).

## Not included
- Client-side pills (143); chart library changes; new metrics.
