---
id: 12
status: doing
model: sonnet
depends_on: [11]
max_attempts: 3
files:
  - web/components/filters.tsx
  - web/components/multi-select.tsx
  - web/components/filter-chips.tsx
  - web/app/licitacoes/page.tsx
---
## Goal
New filter bar: popover multi-selects with per-option counts, removable chips, UF + faixa de valor — per the approved mockup.

## Context
Style: `docs/WEB_STYLE.md` (controls, shadow-card popovers, rounded-full chips, accent active states). Data contract: ticket 11's `LicitacaoFilters` arrays + `fetchFacetCounts` (page passes counts down; no client fetching).

`multi-select.tsx` (client): trigger button showing label + selected count ("Modalidade · 2"), popover card with checkbox list `{value, label, count}`; search input inside when >10 options (portal); "Aplicar" submits the enclosing GET form (options render as checked `<input type="checkbox" name="modalidade" value="6">` — native form submission carries repeated params, no JS state manager); Esc/outside-click closes. Trigger shows accent border when any selected.

`filter-chips.tsx` (server): one chip per active selection ("Pregão - Eletrônico ×", "SP ×", "R$ 50.000–500.000 ×"), each an anchor to the URL minus that value; "Limpar tudo" → `/licitacoes`.

`filters.tsx` rewrite: row 1 palavra-chave + valor min/max (`type="number"`, placeholders "Valor mín/máx") + Buscar; row 2 the five popovers (Status, Modalidade, Setor, UF, Portal) + Categoria native select; chips row below. All inside ONE GET form.

Keyboard: triggers and options focusable, visible focus ring (`focus-visible:ring-2 ring-accent/40`).

## Checks (run in order — cheapest first)
1. `cd web && npx tsc --noEmit`
2. `cd web && npx vitest run`
3. `cd web && npm run build`
4. `cd web && (npm run start -- -p 3100 &) && sleep 5 && curl -s "localhost:3100/licitacoes?modalidade=6&modalidade=8&uf=SP" | grep -q "Limpar tudo" && pkill -f "next-server"`

## Done when
- Multi-select via popovers works end-to-end (select 2 modalidades + 1 UF → chips appear → removing a chip re-filters); counts visible per option; valor range applies.
- Visual matches WEB_STYLE (verified in browser by orchestrator after ticket).

## Not included
- No saved presets, no debounced live search, no dashboard changes, no animation library.
