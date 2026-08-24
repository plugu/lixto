---
id: 41
status: done
model: sonnet
depends_on: []
max_attempts: 3
files:
  - web/app/layout.tsx
  - web/app/page.tsx
  - web/components/ui/top-bar.tsx
---
## Goal
App shell and home page render cleanly at 375px: responsive content padding, working drawer nav, stacked hero stats.

## Context
Root layout (`web/app/layout.tsx:41`) wraps content in `mx-auto max-w-5xl px-8 py-10 has-[.page-wide]:max-w-screen-2xl` — fixed `px-8 py-10` wastes ~64px at 375px. Body is `flex-col md:flex-row` (line 37); desktop sidebar is `hidden md:flex` and must NOT change. Mobile nav already exists: `web/components/ui/top-bar.tsx` renders a hamburger + fixed drawer (`w-72 max-w-[80vw]`) below `md` — verify it works at 375px and fix any overflow/z-index/tap-target issues found. Home (`web/app/page.tsx:20-60`): hero centered `max-w-2xl`, stats use `grid grid-cols-3 gap-4` with no breakpoint — cramped at 375px.

Changes: shell padding → `px-4 py-6 sm:px-6 md:px-8 md:py-10` (keep `max-w-5xl` / `.page-wide` behavior); home stats → `grid-cols-1 sm:grid-cols-3` (or `grid-cols-3` with smaller gap if content fits legibly — judge by content width). Desktop (≥768px) rendering must be pixel-identical.

## Checks (run in order — cheapest first)
1. `cd web && npm run lint`
2. `cd web && npm run build`
3. `cd web && npm run test`

## Done when
- At 375px viewport: no horizontal page scroll on `/`; drawer opens/closes; content padding is `px-4`.
- At ≥768px: layout classes produce the same rendering as before (only additive responsive prefixes below `md`).

## Not included
- Sidebar component internals (`web/components/sidebar.tsx`) — desktop-only, untouched.
- Any other page. Tables, filters, charts — other tickets.
- New breakpoints in globals.css; use Tailwind defaults.
