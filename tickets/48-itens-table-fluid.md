---
id: 48
status: done
model: sonnet
depends_on: [47]
max_attempts: 3
files:
  - web/components/itens-table.tsx
  - web/components/ui/table.tsx
---
## Goal
Make the itens table fluid inside its new white card: fill the card width, scroll horizontally inside the card only when needed, never overflow the page.

## Context
`ItensTable` (`web/components/itens-table.tsx`) renders the kit `Table` (`web/components/ui/table.tsx`) inside `<div className="hidden overflow-x-auto md:block">` for md+, and a stacked `<ul>` card list below md. After ticket 47 it sits inside a `Card` (`bg-surface rounded-lg shadow-card p-4 sm:p-6`).

Two problems to fix:
1. `THead` hardcodes `bg-canvas` for its sticky header — wrong inside a white card (gray band over white). Add an optional `bg` escape to the kit: e.g. `THead` accepts `className` merged onto the `<thead>`, keeping `bg-canvas` as default so `/licitacoes` and other canvas-context tables are unchanged. Then pass `bg-surface` (overriding) from `ItensTable`.
2. Fluidity: `Table` is `w-full border-collapse`. Long `descricao` values must wrap (not force the table wide) — constrain the Descrição column (e.g. `max-w-[28rem] whitespace-normal` on that TD/TH or a `w-full` column strategy) so the table fills the card at 1024–1440px without horizontal scroll in the common case; scroll only appears when content genuinely cannot fit. The scroll container must stay inside the card (a full-bleed negative-margin wrapper `-mx-4 sm:-mx-6 px-4 sm:px-6` is acceptable so the scroll region spans the card edge-to-edge).

Tailwind class-name merging in this kit is plain string concat (`cn` in table.tsx) — later class wins in CSS only if specificity allows; for the bg override prefer replacing the default when a className containing `bg-` is passed, or add a `bg?: "canvas" | "surface"` prop. Keep it minimal.

If executed in a git worktree: copy node_modules with `cp -Rc`, never symlink (Turbopack breaks).

## Checks (run in order — cheapest first)
1. `cd web && npm run lint`
2. `cd web && npm run build`
3. `cd web && npm run test`

## Done when
- At md+ the table fills the card width; long descriptions wrap; horizontal scroll appears only inside the card when columns truly cannot fit.
- Sticky header background matches the card (no gray band).
- `/licitacoes` list tables (canvas context) visually unchanged.

## Not included
- Mobile (<md) stacked list — already handled; only touch if lint/build forces it.
- Column removal/reorder, sorting, pagination.
- Page layout (ticket 47) or AnalisePanel (ticket 49).
