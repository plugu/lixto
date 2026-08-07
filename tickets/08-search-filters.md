---
id: 08
status: done
model: sonnet
depends_on: [07]
max_attempts: 3
files:
  - web/app/page.tsx
  - web/components/filters.tsx
  - web/lib/queries.ts
  - web/lib/queries.test.ts
---
## Goal
Search + filters on the list page: palavra-chave, portal, modalidade, status — all via URL params, combinable.

## Context
Style: `docs/WEB_STYLE.md` (filter toolbar spec). All state in URL query params (`?q=&portal=&modalidade=&status=&pagina=`) so results are shareable; server component re-queries on navigation.

`web/lib/queries.ts`: one parameterized SQL builder (never string-interpolate values):
- `q` → `websearch_to_tsquery('portuguese', $q)` matched against `to_tsvector('portuguese', objeto_compra)` **OR** `EXISTS (select 1 from item where item.numero_controle_pncp = licitacao.numero_controle_pncp and to_tsvector('portuguese', coalesce(item.descricao,'')) @@ query)` — both sides use the ticket-07 GIN indexes.
- `portal` → `licitacao.portal = $portal`; dropdown options from `select distinct portal ... where portal is not null order by 1`.
- `modalidade` → `modalidade_id = $n`; options from distinct id+nome in DB.
- `status` → date logic from `lib/status.ts` translated to SQL (aberta / vai_abrir / fechada).

Toolbar: text input (Palavra-chave, submits on Enter), three selects with "Todos" default, result count ("N licitações"), "Limpar filtros" link when any active. Pagination preserves all params.

## Checks (run in order — cheapest first)
1. `cd web && npx tsc --noEmit`
2. `cd web && npx vitest run`
3. `cd web && npm run build`
4. `cd web && (npm run start -- -p 3100 &) && sleep 5 && curl -s "localhost:3100/?status=aberta&q=merenda" | grep -qi "licita" && pkill -f "next start"`

## Done when
- Each filter alone and combined narrows results; URL fully encodes state; count updates.
- `queries.test.ts`: SQL builder produces correct WHERE/params for each filter and combinations (no DB needed).

## Not included
- No saved searches, no autocomplete, no debounced live search, no faceted counts per option.
