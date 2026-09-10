---
id: 141
status: done
model: sonnet
depends_on: [140]
max_attempts: 3
files:
  - web/app/loading.tsx
  - web/app/(app)/dashboard/loading.tsx
  - web/app/(app)/opportunities/loading.tsx
  - web/app/(app)/procurements/loading.tsx
  - web/app/(app)/radar/loading.tsx
  - web/app/(app)/radar/[id]/loading.tsx
  - web/app/(app)/procurement/[sourceId]/loading.tsx
  - web/app/(app)/company/loading.tsx
  - web/components/ui/page-header.tsx
---
## Goal
Every in-app route shows a layout-shaped skeleton the instant a link is clicked, so navigation never freezes on the old page, and `Link` prefetch becomes useful for `force-dynamic` routes.

## Context
Only `web/app/loading.tsx` exists (three centred grey bars, full-screen). Because it sits *above* `web/app/(app)/layout.tsx`, it never shows on in-app navigation (the shared layout segment is preserved) and it is also the reason `notFound()` streams HTTP 200 (STATE.md follow-up). **Delete `web/app/loading.tsx`.** Add one `loading.tsx` per route folder listed in `files:`; each is a server component built only from `Skeleton`/`SkeletonText` (`@/components/ui/skeleton`, ticket 140) and mirrors the real page's boxes so the swap has no layout shift:

- `dashboard`: title bar + 3 stat tiles (`h-[84px] rounded-[10px]`) + 4 stat tiles + two `h-40` chart boxes; outer `flex flex-col gap-10` like the page.
- `opportunities`: title + banner (`h-14`) + 3 pills (`h-7 w-20 rounded-full`) + 6 cards (`h-[168px]`) in `grid lg:grid-cols-2 gap-3`.
- `procurements`: wrapper `className="page-wide flex flex-col gap-5"` (keeps the wide container, see `(app)/layout.tsx` `has-[.page-wide]`), toolbar `h-9`, then 10 rows `h-14 border-b border-line`.
- `radar`: two-line title (`h-8 w-3/4`, `h-8 w-1/2`), pills, toolbar `h-16`, 6 cards `h-[140px]` grid `lg:grid-cols-2`.
- `radar/[id]` and `procurement/[sourceId]`: title `h-8 w-2/3`, meta line, then `grid lg:grid-cols-[1fr_320px] gap-8` with a `SkeletonText lines=8` main and a `h-64` aside.
- `company`: title + form block `h-96`.

Also add `web/components/ui/page-header.tsx`: `PageHeader({ title, subtitle?, actions? })` rendering the `<h1 className="font-display text-[30px] leading-[34px] text-ink">` used by every page today, so skeletons and pages share one title style (pages migrate to it in later tickets; do not edit pages here).

## Checks (run in order — cheapest first)
1. `cd web && npm run lint`
2. `cd web && test ! -f app/loading.tsx && for d in dashboard opportunities procurements radar 'radar/[id]' 'procurement/[sourceId]' company; do test -f "app/(app)/$d/loading.tsx" || exit 1; done`
3. `cd web && npm run build`
4. `cd web && npm test`
5. `cd web && curl -s -o /dev/null -w '%{http_code}' localhost:3000/procurement/does-not-exist | grep -q 404` (needs `npm run dev` + local DB)

## Done when
- Clicking any sidebar item renders that route's skeleton immediately, sidebar stays mounted.
- `/procurement/<unknown>` returns HTTP 404 (root `loading.tsx` gone).

## Not included
- Suspense boundaries *inside* pages (142, 144).
- Changing page markup or titles.
