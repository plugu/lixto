---
id: 44
status: done
model: sonnet
depends_on: []
max_attempts: 3
files:
  - web/app/licitacao/[numeroControle]/page.tsx
  - web/components/itens-table.tsx
  - web/components/analise-panel.tsx
  - web/components/documentos-list.tsx
---
## Goal
Licitação detail page fully readable at 375px: facts grid stacks, itens reflow to cards, análise tables fit.

## Context
`web/app/licitacao/[numeroControle]/page.tsx`: line 92 facts `grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-4` — 2-col at 375px OK but verify long values (órgão names) wrap not overflow (`min-w-0`/`break-words` where needed). Line 134 `grid gap-10 lg:grid-cols-[1fr_22rem]` already stacks below lg — verify only.

`web/components/itens-table.tsx:23-24` — `overflow-x-auto` + `Table density="compact"`, 8 columns (Nº, Descrição, Qtd, Un, Valor Unit, Valor Total, Situação, Benefício). Below `md`: stacked cards inside the same component file — descrição (clamped) + nº top line; qtd×un, valor unit, valor total row; situação/benefício badges. Table stays `hidden md:block`, cards `md:hidden`.

`web/components/analise-panel.tsx:59` — requirements `overflow-x-auto` + compact Table: acceptable to keep horizontal scroll below `md` (deliberate scroll container), but ensure the container actually constrains (`min-w-0` up the flex chain) so the page itself never scrolls sideways. `documentos-list.tsx:30` is flex list — verify long filenames truncate.

## Checks (run in order — cheapest first)
1. `cd web && npm run lint`
2. `cd web && npm run build`
3. `cd web && npm run test`

## Done when
- At 375px: detail page has no horizontal page scroll; itens render as cards; análise table scrolls only inside its own container.
- At ≥768px: itens table identical to before.

## Not included
- Análise content/logic, agents, queries. List page (ticket 43).
