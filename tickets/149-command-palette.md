---
id: 149
status: done
model: opus
depends_on: [146]
max_attempts: 3
files:
  - web/components/ui/command-search.tsx
  - web/components/sidebar.tsx
  - web/components/ui/top-bar.tsx
  - web/app/(app)/search/actions.ts
  - web/lib/command-search-queries.ts
  - web/lib/command-search-queries.test.ts
  - web/lib/tenant-isolation.test.ts
  - web/lib/keyboard-shortcuts.ts
---
## Goal
⌘K opens a real command palette (`cmdk`): navigation commands, recent procurements, and live procurement results, with keyboard-first navigation and no full-page reload; `g` then a letter jumps between sections.

## Context
`command-search.tsx` is one input inside a GET form to `/procurements`. `sidebar.tsx` exports `NAV_ITEMS`, `COMPANY_ITEMS`, `COMPANY_ADMIN_ITEMS` and renders `<CommandSearch/>` when expanded; `top-bar.tsx` is the mobile header (add a search icon button that opens the same palette). `cmdk@1.1.1` is installed (ticket 140); `Link` comes from `next-view-transitions` (146).

Work:
1. `lib/command-search-queries.ts`: `buildCommandSearchQuery(q, limit=8): SqlQuery` — keyword-only (`websearch_to_tsquery('portuguese', f_unaccent($1))` against the same tsvector column `fetchProcurements` uses in `lib/procurement-queries.ts`; copy the expression, no embeddings), returns `source_id, description, agency_name, state, proposal_closes_at`, ordered by rank then `proposal_closes_at`; plus `searchProcurementsForPalette(q)` wrapper. Unit-test the SQL shape and param binding; register in `tenant-isolation.test.ts` only if the query takes `company_id` (it does not — public data; document that in a comment and skip registration).
2. `app/(app)/search/actions.ts`: `"use server"` `paletteSearchAction(q: string)` → `requireSession()` then the query; trims, returns `[]` under 2 chars.
3. `command-search.tsx`: `cmdk` `Command.Dialog` styled with tokens (`bg-surface border-line rounded-[10px] shadow-popover`, max-w-lg, top 15vh), groups: **Ir para** (all nav items the session may see — pass `role` prop from the sidebar), **Recentes** (last 5 opened procurements from `localStorage` key `lixto.recent`, written by the palette on select), **Licitações** (live results, 250 ms debounce, `useTransition`, "Buscando…" state, "Ver todos os resultados" item → `/procurements?q=`). Enter navigates with `useRouter().push`; `Esc` closes; footer shows `↑↓ navegar · ↵ abrir · esc fechar`.
4. `lib/keyboard-shortcuts.ts` + hook usage in `sidebar.tsx`: `g o`→/opportunities, `g r`→/radar, `g p`→/dashboard, `g l`→/procurements, `?` opens palette; ignored when focus is in an input/textarea/contenteditable. Show the hint (`G O`) as `text-[11px] text-ink-faint` at the right of each expanded nav item.

## Checks (run in order — cheapest first)
1. `cd web && npm run lint`
2. `cd web && npx vitest run lib/command-search-queries.test.ts lib/tenant-isolation.test.ts`
3. `cd web && npm run build`
4. `cd web && npm test`

## Done when
- ⌘K → typing "limpeza" lists up to 8 procurements within ~300 ms and Enter opens the detail page client-side; `g r` from any page opens Radar.

## Not included
- Searching radar items, companies or documents; AI answers in the palette.
