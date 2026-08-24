---
id: 47
status: done
model: sonnet
depends_on: []
max_attempts: 3
files:
  - web/components/ui/card.tsx
  - web/app/licitacao/[numeroControle]/page.tsx
---
## Goal
Create a `Card` primitive and restructure the licitação detail page so header, Itens and Documentos each sit in a white card over the canvas background.

## Context
Design tokens live in `web/app/globals.css` (Tailwind v4 `@theme`): `bg-surface` (#fff), `bg-canvas` (#f8fafc, already the body background via `app/layout.tsx`), `border-line`, `shadow-card` (1px shadow + line ring), `rounded-lg` (10px). Buttons use square-rounded corners — keep that language, no pill radii.

Create `web/components/ui/card.tsx`: a `Card` component — `<div>` with `bg-surface rounded-lg shadow-card`, padding `p-4 sm:p-6`, accepts `className` merged after defaults, `children`. No border prop, no variants — `shadow-card` already carries the hairline ring.

In `web/app/licitacao/[numeroControle]/page.tsx`:
- Wrap the `<header>` content in a `Card` (title, meta line, badges, facts `<dl>`, external links).
- Wrap `<Section title="Itens">…</Section>` and `<Section title="Documentos">…</Section>` each in a `Card`.
- Leave `AnalisePanel` and its sticky wrapper untouched (ticket 49 styles it).
- Keep `page-wide`, the `lg:grid-cols-[1fr_22rem]` grid, gaps may tighten (cards carry separation now — `gap-6` between cards is enough).
- Also wrap the "Licitação não encontrada." empty state in a Card.
- Do not modify `web/components/ui/section.tsx` — it is shared by many pages.

If executed in a git worktree: Turbopack breaks with symlinked node_modules — copy with `cp -Rc <main>/web/node_modules web/node_modules`, never symlink.

## Checks (run in order — cheapest first)
1. `cd web && npm run lint`
2. `cd web && npm run build`
3. `cd web && npm run test`

## Done when
- Detail page renders header, Itens, Documentos as three white cards on the gray canvas; análise column untouched.
- Empty state ("não encontrada") also renders inside a card.

## Not included
- ItensTable internals (ticket 48), AnalisePanel styling (ticket 49).
- `/licitacoes` list, `licitacao-card`, or applying Card anywhere else.
- No data/query/logic changes.
