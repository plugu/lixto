---
id: 37
status: done
model: sonnet
depends_on: [32, 33, 34, 35, 36]
max_attempts: 3
files:
  - web/public/favicon.svg
  - web/public/logo.svg
  - web/app/not-found.tsx
  - web/app/error.tsx
  - web/app/loading.tsx
  - web/app/layout.tsx
  - web/lib/db.ts
  - web/components/ui/table.tsx
  - web/components/sidebar.tsx
  - web/components/filters.tsx
---
## Goal
Final polish so the whole app reads as one product: favicon + wordmark asset, branded `not-found`/`error`/`loading` states on the kit, dead placeholder assets removed, lint clean; then the orchestrator merges and verifies the deployed site.

## Context
`web/public/` has unreferenced `file.svg globe.svg next.svg vercel.svg window.svg` — delete them (keep `robots.txt`). Add `favicon.svg` (simple monogram "PL" on accent) and `logo.svg` (wordmark), reference favicon in `layout.tsx` metadata (`icons: { icon: "/favicon.svg" }`). Sidebar/top-bar logo row (ticket 31) used a text wordmark — leave it.

Add `app/not-found.tsx` (EmptyState "Página não encontrada" + LinkButton "Voltar ao início"), `app/error.tsx` (client, EmptyState with `reset` button), `app/loading.tsx` (skeleton: 3 hairline rows using `animate-pulse` on `surface-raised`).

`npm run lint` currently red on `lib/db.ts` (pre-existing — fix only what eslint reports there, likely `no-var`/global typing) and on `components/sidebar.tsx` ~line 95 (`react-hooks/set-state-in-effect`: reading `localStorage` for the collapsed state inside an effect — fix by lazy `useState` initializer guarded with `typeof window !== "undefined"` + try/catch, or `useSyncExternalStore`; keep behavior).

Kit defect from ticket 33 (fix in `components/ui/table.tsx`, then simplify the workaround in `components/filters.tsx`): `TR({href})` currently prepends a zero-width `<td>` holding an absolute-inset `<Link>`, and `TD` is `position: relative`, so cells paint over the link and swallow clicks. Fix:
- `TR({href})`: keep the extra first `<td>` but make it `w-0 p-0 border-0 relative` and render `<Link className="absolute inset-y-0 left-0 w-[100vw] z-[1]" aria-label={…}>`; the overlay spans the row.
- `TD`: drop `position: relative` (static). Any interactive child inside a cell (links, buttons) gets `relative z-[2]` so it stays clickable above the overlay.
- `THead({rowLinks?: boolean})`: when true, prepend `<th className="w-0 p-0 border-0" aria-hidden />` so headers align with link rows.
- `filters.tsx`: remove the `ColTD position:static` override and the manual blank `TH`; use `THead rowLinks` and plain `TD`. Re-check `/licitacoes` row click still navigates and Fit/Status cells don't break it.

After checks pass, **orchestrator** merges the cycle branch to `main`, pushes, waits for the Dokploy deploy, and screenshots `/licitacoes` + `/` in production.

## Checks (run in order — cheapest first)
1. `cd web && npx tsc --noEmit`
2. `cd web && npm run lint`
3. `cd web && npx vitest run`
4. `cd web && npm run build`
5. `test ! -e web/public/next.svg && test -s web/public/favicon.svg`

## Done when
- Lint/tests/build green; branded 404/error/loading; favicon present; placeholder SVGs gone.

## Not included
- No page redesign work, no dark mode, no deploy config changes.
