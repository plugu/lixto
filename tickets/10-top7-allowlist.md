---
id: 10
status: done
model: sonnet
depends_on: []
max_attempts: 3
files:
  - web/lib/portais.ts
  - web/lib/queries.ts
  - web/lib/stats-queries.ts
  - web/lib/queries.test.ts
---
## Goal
Platform-wide top-7 portal allowlist: every list, count, chart and filter option considers only licitações from the 7 main portals.

## Context
New `web/lib/portais.ts` exports `PORTAIS_ATIVOS: string[]` — exactly these `usuario_nome` values:
Compras.gov.br · ECustomize Consultoria em Software S.A · IPM Sistemas · Betha Sistemas · Governançabrasil Tecnologia e Gestão em Serviços · BLL Compras · Megasoft Informática.

Apply as a base predicate `usuario_nome = ANY(...)` (bound param) in:
- `queries.ts`: `buildWhereClause` always includes it (even with no user filters — the WHERE is never empty anymore; adjust tests asserting empty WHERE), `buildPortalOptionsQuery` (only allowlisted), count/list queries inherit via the shared clause.
- `stats-queries.ts`: `fetchStatusCounts`, `fetchTopCounts` (portal chart: 7 bars max, no "Outros" fold needed for portal; modalidade keeps its fold), `fetchPorDia`.

DB rows from other portals stay untouched and keep syncing — this is read-side only. `usuario_nome` is indexed (idx_licitacao_usuario_nome).

## Checks (run in order — cheapest first)
1. `cd web && npx tsc --noEmit`
2. `cd web && npx vitest run`
3. `cd web && npm run build`
4. `cd web && (npm run start -- -p 3100 &) && sleep 5 && curl -s localhost:3100/licitacoes | grep -o "licita" | head -1 && curl -s localhost:3100/ | grep -qv "Outros (" && pkill -f "next start"`

## Done when
- `/` and `/licitacoes` totals drop to the top-7 base (~246k, not 556k); portal chart shows only allowlisted names; portal dropdown lists exactly 7.
- Tests cover: allowlist present in every builder's SQL, portal options restricted.

## Not included
- No ingestion/scheduler changes. Detail page for a non-allowlisted licitação stays reachable via direct URL (no 404 gate). No UI redesign (tickets 11–12).
