---
id: 42
status: done
model: sonnet
depends_on: []
max_attempts: 3
files:
  - web/app/painel/page.tsx
  - web/components/charts/daily-line.tsx
  - web/components/charts/bar-list.tsx
---
## Goal
Dashboard (painel) is fully usable at 375px: KPI grid stacks sanely and charts stay legible, no fixed-width overflow.

## Context
`web/app/painel/page.tsx:47` — KPI cards `grid grid-cols-2 gap-4 lg:grid-cols-4`; 2-up at 375px is acceptable if numbers don't truncate — verify, else `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4`. Line 84 — chart sections `grid grid-cols-1 gap-10 lg:grid-cols-2` (already stacks, OK).

`web/components/charts/daily-line.tsx:8-13` — hand-rolled SVG with fixed `W=720 H=180`, `viewBox="0 0 720 180"`, `className="w-full"`. viewBox scaling shrinks axis text ~50% at 375px → illegible. Fix: make it a client component that measures container width (ResizeObserver or `useLayoutEffect` + ref) and recomputes W/tick count/label density for narrow widths; keep 720 layout at md+. Alternative acceptable: keep server component, wrap in `overflow-x-auto` with `min-w-[560px]` on phone — pick the measured approach unless it exceeds attempt budget.

`web/components/charts/bar-list.tsx:16` — `grid grid-cols-[minmax(0,11rem)_1fr_auto]`; 11rem label column leaves ~10ch for bars at 375px. Below `sm`: stack label above bar (two-row grid) or shrink label col to `minmax(0,7rem)` with truncate.

## Checks (run in order — cheapest first)
1. `cd web && npm run lint`
2. `cd web && npm run build`
3. `cd web && npm run test`

## Done when
- At 375px: `/painel` has no horizontal page scroll; chart axis labels readable; bar labels truncate instead of crushing bars.
- At ≥1024px: rendering unchanged.

## Not included
- Chart library adoption (no recharts etc.) — stay hand-rolled SVG.
- Home page stats grid (ticket 41). Data queries untouched.
