---
id: 49
status: done
model: sonnet
depends_on: [47]
max_attempts: 3
files:
  - web/components/analise-panel.tsx
---
## Goal
Give the AnalisePanel its own distinct card treatment — visually differentiated from the plain white cards, still in the sticky sidebar.

## Context
`AnalisePanel` (`web/components/analise-panel.tsx`) renders a kit `Section` with eyebrow "Análise": FitBadge, reasoning text, and (deep analysis) Requisitos table, Prazos, Riscos. The page keeps it in `lg:sticky lg:top-8` at `22rem` wide; ticket 47 leaves it untouched.

Tokens (`web/app/globals.css`): `accent` #0f766e (teal), `accent-soft` #e5f4f2, `surface`, `line`, `shadow-card`, `rounded-lg`. `Card` primitive exists at `web/components/ui/card.tsx` (ticket 47: `bg-surface rounded-lg shadow-card p-4 sm:p-6`, merges `className`).

Treatment: wrap panel content in `Card` with a distinguishing accent — recommended: `border-t-2 border-t-accent` on the card (or a soft accent header band `bg-accent-soft` behind eyebrow+FitBadge, `-m` full-bleed to card edges). Pick ONE device, keep it quiet — this is a data app, not a marketing page. The internal Requisitos table's `THead` sticky `bg-canvas` will look wrong on white: pass the surface background override added by ticket 48, or make the thead non-sticky here (sidebar table is short — non-sticky acceptable).

Panel returns `null` without analise row — keep that. Do not modify `section.tsx` (shared).

If executed in a git worktree: copy node_modules with `cp -Rc`, never symlink (Turbopack breaks).

## Checks (run in order — cheapest first)
1. `cd web && npm run lint`
2. `cd web && npm run build`
3. `cd web && npm run test`

## Done when
- Análise renders as a card visually distinct from the three white cards (accent device), sticky behavior preserved on lg.
- Requisitos/Prazos/Riscos remain readable inside the card at 22rem width without overflowing.

## Not included
- Changes to FitBadge, analysis data, or verdict logic.
- Page layout (ticket 47), ItensTable (ticket 48).
