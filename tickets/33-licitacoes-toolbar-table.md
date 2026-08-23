---
id: 33
status: todo
model: opus
depends_on: [31]
max_attempts: 3
files:
  - web/app/licitacoes/page.tsx
  - web/components/filters.tsx
  - web/components/multi-select.tsx
  - web/components/filter-chips.tsx
  - web/components/status-badge.tsx
  - web/components/fit-badge.tsx
---
## Goal
`/licitacoes` becomes the Attio-style data view: toolbar (Buscar · Filtrar · Ordenar · Colunas, counts as badges) above a dense table with status dots and fit badges, rows clickable, sticky header, same URL contract as today.

## Context
Read `docs/design/cycle8-direction.md` and `web/components/ui/*.tsx` first. Hard constraint: **URL params and `parseFilters` (`web/lib/queries.ts`) are frozen** — `q`, `portal[]`, `modalidade[]`, `status[]`, `categoria`, `setor[]`, `uf[]`, `valorMin`, `valorMax`, `fit[]`, `pagina`. `queries.test.ts` (503 lines) must stay green; do not edit `lib/`.

Today: `page.tsx` (294 lines, `page-wide`, PAGE_SIZE 25) renders `<Filters filters facetCounts>` (client GET form with 5 `MultiSelect`s + q/valorMin/valorMax/categoria auto-submit), an inline Fit GET form, `<FilterChips>` (server `<Link>`s rebuilding `URLSearchParams`), a table (Objeto/Modalidade/Status/Fit/Valor/Encerramento) and pagination. `multi-select.tsx`: hidden inputs carry values, "Aplicar" calls `form.requestSubmit()`; `filter-chips.tsx` deletes `pagina` on every chip.

New structure:
- Page header row: title "Licitações" + count "23.381 resultados" (tabular-nums) at left; right: `SearchBox size="inline" name="q"` inside the same GET form.
- `Toolbar`: `ToolbarButton icon=Filter label="Filtrar" count={activeFilterCount}` opens a `Popover` containing the existing `MultiSelect`s (portal, modalidade, status, setor, uf, fit) + categoria + valor range in a 2-column grid with one "Aplicar" — all inside ONE GET form so hidden inputs still submit together; `ToolbarButton icon=Columns label="Colunas"` → popover with checkboxes toggling column visibility client-side (state in `localStorage` key `plic.licitacoes.cols`, default all on); `ToolbarButton icon=Sort label="Ordenar"` → disabled/tooltip "em breve" (no sort param exists — do not invent one). Filter chips row under the toolbar (restyled `FilterChips`, pill `Badge`s with × as `Link`).
- Table via kit `Table density="default"`: columns Objeto (title 14px + órgão/localização 12px muted, 2-line clamp, `min-w-[24rem] max-w-[40rem]`), Modalidade, Status (`StatusDot` ok/warn/off for aberta/vai_abrir/fechada), Fit (`FitBadge` restyled), Valor (numeric, right), Encerramento (right). `TR href=/licitacao/…` for whole-row click. Keep `overflow-x-auto` + `min-w-[960px]`.
- `status-badge.tsx` → thin wrapper over `StatusDot`; `fit-badge.tsx` → wrapper over `Badge` tones (fit=ok, borderline=warn, no_fit=neutral), shows score.
- Pagination: ghost buttons "Anterior / Próxima" + "página X de Y" right-aligned, same `pagina` param.
- Empty: `EmptyState icon=Search title="Nenhuma licitação encontrada" action=<Limpar filtros>`.

## Checks (run in order — cheapest first)
1. `cd web && npx tsc --noEmit`
2. `cd web && npx vitest run`
3. `cd web && npx eslint components/multi-select.tsx components/filters.tsx app/licitacoes` (pre-existing lint errors in `multi-select.tsx` must be fixed here)
4. `cd web && npm run build`
5. `cd web && (npm run start -- -p 3100 &) && sleep 5 && curl -s localhost:3100/login | grep -q 'font-display' && pkill -f "next-server"`

## Done when
- Same URLs produce same results; toolbar/popover filters submit as one form; chips still remove individual values; columns toggle persists; rows link to detail.

## Not included
- No sort implementation, no new params, no `lib/` edits, no detail page, no saved views.
