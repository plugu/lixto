---
id: 43
status: done
model: sonnet
depends_on: []
max_attempts: 3
files:
  - web/app/licitacoes/page.tsx
  - web/components/licitacao-card.tsx
  - web/components/filters.tsx
  - web/components/filter-chips.tsx
---
## Goal
Licitações list works one-handed at 375px: rows reflow to stacked cards, filter popover and chips fit the viewport.

## Context
`web/app/licitacoes/page.tsx:83-86` — `overflow-x-auto` wrapper + `Table min-w-[960px]`, 6 columns (Objeto, Modalidade, Status, Fit, Valor, Encerramento), some toggleable via `ColTH`. Keep the table for `md:` and up, untouched. Below `md`: render NEW component `web/components/licitacao-card.tsx` — stacked cards, one per licitação: objeto (link, 2-line clamp) on top; órgão/modalidade line; badges row (StatusBadge, FitBadge from existing components); valor + encerramento line. Use existing kit (`web/components/ui/badge.tsx`, table page markup as data reference). Hide table below `md` (`hidden md:block`), cards `md:hidden` — same data array, no query changes.

`web/components/filters.tsx:270-271` — Popover panel `w-[34rem] max-w-[calc(100vw-5rem)]` with `grid grid-cols-2` → at 375px panel is ~295px with 2 crushed columns. Fix: `max-w-[calc(100vw-2rem)]`, grid `grid-cols-1 sm:grid-cols-2`; verify popover doesn't overflow viewport edge. Search input `max-w-xs` (line 248) — allow full width below `sm`. `filter-chips.tsx:168` already `flex-wrap` — verify only.

## Checks (run in order — cheapest first)
1. `cd web && npm run lint`
2. `cd web && npm run build`
3. `cd web && npm run test`

## Done when
- At 375px: `/licitacoes` shows cards (no 960px table, no horizontal page scroll); filter popover fully visible and usable; chips wrap.
- At ≥768px: table view identical to before.

## Not included
- Column-toggle feature for cards — cards show the fixed field set above.
- Pagination/sorting changes, query changes, detail page (ticket 44).
