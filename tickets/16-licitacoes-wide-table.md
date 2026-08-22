---
id: 16
status: done
model: sonnet
depends_on: []
max_attempts: 2
files:
  - web/app/layout.tsx
  - web/app/licitacoes/page.tsx
  - docs/WEB_STYLE.md
---
## Goal
`/licitacoes` uses the full available width (up to `max-w-screen-2xl`) so all six table columns render without clipping; on narrow windows the table scrolls horizontally instead of hiding columns.

## Context
Root layout (`web/app/layout.tsx`) wraps every page in `<div className="mx-auto max-w-5xl px-8 py-10">`. `/licitacoes` has six columns and a `max-w-md` Objeto cell inside an `overflow-hidden` wrapper, so the table is squeezed and nothing scrolls.

Opt-out mechanism (no route groups, no file moves): Tailwind v4 `has-[]` variant on the layout wrapper:

```tsx
<div className="mx-auto max-w-5xl px-8 py-10 has-[.page-wide]:max-w-screen-2xl">{children}</div>
```

In `web/app/licitacoes/page.tsx`, add the `page-wide` class to the page's outermost element (the top-level wrapper returned by the page component — if there is none, wrap the returned fragment in `<div className="page-wide">`). Every other page keeps `max-w-5xl` untouched.

Table changes in `web/app/licitacoes/page.tsx` (around lines 168–242):
- Wrapper: `overflow-hidden` → `overflow-x-auto` (keep `rounded-lg border border-border bg-card shadow-subtle`).
- Table: `w-full text-sm` → add `min-w-[960px]` so narrow windows scroll instead of crushing columns.
- Objeto `<td>`: replace `max-w-md` with `min-w-[24rem] max-w-[40rem]`; keep `line-clamp-2` + truncate org line.
- Modalidade / Status / Fit cells: add `whitespace-nowrap`. Valor / Encerramento already `tabular-nums`; add `whitespace-nowrap`.
- Font size: table `text-sm` → `text-base` (body cells inherit). Objeto link stays `font-medium`; the org/location sub-line under it goes `text-xs` → `text-sm`. Header `<th>` cells keep their current size (add explicit `text-sm` on `<thead>` so they don't grow with the table). Badges (`StatusBadge`, `FitBadge`) unchanged.

`docs/WEB_STYLE.md`: update the "Main" line (~28) to mention the `page-wide` opt-out, and the Tables line (~32) to say `overflow-x-auto` for wide tables.

## Checks (run in order — cheapest first)
1. `cd web && npx tsc --noEmit`
2. `cd web && npm run build`
3. `cd web && (npm run start -- -p 3100 &) && sleep 5 && curl -s "localhost:3100/licitacoes" | grep -q "page-wide" && curl -s "localhost:3100/licitacoes" | grep -q "overflow-x-auto" && pkill -f "next-server"`

## Done when
- Build passes; `/licitacoes` HTML contains `page-wide` and `overflow-x-auto`; table rows render at `text-base`; `/licitacao/[id]` and `/` still render inside `max-w-5xl`.

## Not included
- No global width change, no column add/remove/reorder, no responsive card layout, no query/filter changes, no changes to `filters.tsx`/`filter-chips.tsx`.
