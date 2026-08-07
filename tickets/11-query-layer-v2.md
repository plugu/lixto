---
id: 11
status: doing
model: sonnet
depends_on: [10]
max_attempts: 3
files:
  - web/lib/queries.ts
  - web/lib/queries.test.ts
---
## Goal
Query layer v2: multi-value filters (modalidade, setor, portal, status, UF), faixa de valor, and per-option facet counts — URL-driven, UI unchanged.

## Context
`parseFilters` accepts repeated params (`?modalidade=6&modalidade=8`, same for `setor`, `portal`, `status`, new `uf`) → arrays in `LicitacaoFilters` (`modalidadeIds: number[]`, `setores: string[]`, `portais: string[]`, `statuses: StatusLicitacao[]`, `ufs: string[]`); singular fields replaced project-wide (update `app/licitacoes/page.tsx` call sites minimally — `buildQueryString` emits repeated params; `components/filters.tsx` keeps sending single values, which parse as arrays of 1, so the current UI keeps working until ticket 12). New `valorMin`/`valorMax` (numbers, `valor_total_estimado >= / <=`).

Predicates: `= ANY($n)` for value arrays; statuses OR-combine their date predicates; categoria unchanged. Top-7 base predicate from ticket 10 always present; user `portais` intersect it (both applied).

New `fetchFacetCounts(filters)` → for each of the 5 multi filters, a grouped count query that applies ALL active filters EXCEPT that filter's own selection (standard faceting), returning `{ modalidade: [{value, label, count}], setor: [...], portal: [...], status: [...], uf: [...] }`. UF labels = the sigla itself.

## Checks (run in order — cheapest first)
1. `cd web && npx tsc --noEmit`
2. `cd web && npx vitest run`
3. `cd web && npm run build`
4. `cd web && (npm run start -- -p 3100 &) && sleep 5 && curl -s "localhost:3100/licitacoes?modalidade=6&modalidade=8&status=aberta&uf=SP&uf=MG" | grep -qi "licita" && pkill -f "next-server"`

## Done when
- Repeated URL params narrow results correctly (verified live for modalidade+uf+status combo); valor range works; facet counts exclude own dimension.
- Tests: array parsing (single, repeated, invalid mixed with valid), each predicate, OR-combined statuses, valor range bounds, facet-count query shape.

## Not included
- No UI changes beyond keeping existing single-select filters compiling. No counts rendering (ticket 12). No new indexes.
