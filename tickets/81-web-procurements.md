---
id: 81
status: doing
model: opus
depends_on: [80]
max_attempts: 4
files:
  - web/lib/procurement-queries.ts
  - web/lib/procurement-queries.test.ts
  - web/lib/procurement-detail-queries.ts
  - web/lib/price-queries.ts
  - web/lib/price-queries.test.ts
  - web/lib/stats-queries.ts
  - web/lib/enrichment-queries.ts
  - web/lib/portals.ts
  - web/lib/status.ts
  - web/lib/queries.ts
  - web/lib/queries.test.ts
  - web/lib/detail-queries.ts
  - web/lib/preco-queries.ts
  - web/lib/preco-queries.test.ts
  - web/lib/analise-queries.ts
  - web/lib/enriquecimento-queries.ts
  - web/lib/portais.ts
  - web/app/(app)/dashboard/page.tsx
  - web/app/(app)/procurements/page.tsx
  - web/app/(app)/procurement/[sourceId]/page.tsx
  - web/app/(app)/licitacoes/**
  - web/app/(app)/licitacao/**
  - web/components/filters.tsx
  - web/components/filter-chips.tsx
  - web/components/procurement-card.tsx
  - web/components/licitacao-card.tsx
  - web/components/items-table.tsx
  - web/components/itens-table.tsx
  - web/components/documents-list.tsx
  - web/components/documentos-list.tsx
  - web/components/enrichment-panel.tsx
  - web/components/analise-panel.tsx
  - web/components/fit-badge.tsx
  - web/components/status-badge.tsx
  - web/components/multi-select.tsx
  - web/components/charts/**
  - web/components/ui/command-search.tsx
---
## Goal
Dashboard, procurement list (search + facets) and procurement detail (items, documents, price benchmark, enrichment panel) run on the new schema at `/dashboard`, `/procurements`, `/procurement/[sourceId]`.

## Context

Read `PRODUCT.md`, `docs/adr/001-lixto-data-model.md` (D3: `procurements`, `agency_units`, `procurement_items`, `procurement_documents`, `procurement_results`, `procurement_enrichments` + facet tables), **`web/AGENTS.md`**, `docs/WEB_STYLE.md`. **Port with rename** from `web/lib/queries.ts` (`parseFilters`, `buildWhereClause`, facets), `detail-queries.ts`, `preco-queries.ts` (`buildTsQuery`, LATERAL benchmark, winner-only rule, `enqueue…`), `stats-queries.ts`, and the pages/components listed; same UX and Portuguese copy. Legacy Portuguese-named files are deleted once replaced. Tests: vitest mocked pool.

### Notes from ticket 80 (merged)
- `getSession/requireSession/requireAdmin` return `ActiveSession` (`user`/`company` required) from `web/lib/auth.ts`; `Session` is a compat union until 82 — type your pages with `ActiveSession`. Use `session.user.companyId`, `session.company.id`.
- Compat shims still present (owned by 82, do not extend): `web/lib/tenant-types.ts`, `web/lib/empresa-queries.ts` (`getCnaes`). For company CNAEs use `getCompanyCnaes` from `web/lib/company-queries.ts`.
- Sidebar already links `/procurements` — create that route here.

### Rules
- `procurement-queries.ts`: `ProcurementFilters` = same dimensions (q, portals → `origin_system`, modalityIds, statuses `open|upcoming|closed` with predicates on `proposal_opens_at`/`proposal_closes_at`, categories facet replaces `setor` (join `procurement_categories`), kind facet `product|service|mixed` from `procurement_items.kind`, states, valueMin/Max, compat via `procurement_cnaes ∩ company_cnaes`). `PORTAIS_ATIVOS` allowlist becomes `ACTIVE_PORTALS` in `portals.ts` and is applied as today. `enriched` flag column from `LEFT JOIN procurement_enrichments`.
- The legacy "Fit" column/filter (from `analise`) is **removed**; `fit-badge.tsx` is repurposed as `ScoreBadge`? No — delete `fit-badge.tsx`; list rows show nothing in its place (match scores appear only on `/lixto` cards, ticket 82).
- Detail page `/procurement/[sourceId]`: header, items table with price benchmark column (port `price-queries.ts` against `procurement_results`, `enqueueMissingResults` sets `results_requested_at`), documents list, **enrichment panel** (`enrichment-panel.tsx`, replaces `analise-panel.tsx`): summary, categories chips, requirements table by kind (Portuguese labels for the English enums), risks, delivery, ME/EPP flags, complexity; hidden when no enrichment.
- `status.ts`: `computeStatus(opensAt, closesAt)` → `open|upcoming|closed` + labels (Aberta / Vai abrir / Fechada). `format.ts` untouched.
- `/dashboard`: port `stats-queries.ts` + page; `command-search.tsx` navigates to `/procurements?q=`.
- Remove any compat shims ticket 80 added for these modules once they are gone.

## Checks (run in order — cheapest first)
1. `cd web && npx tsc --noEmit`
2. `cd web && npm run lint`
3. `cd web && npm test`
4. `cd web && npm run build`
5. Runtime probe (local DB with procurements from ticket 75, session cookie as in ticket 80): `curl -s -o /tmp/p.html -w '%{http_code}\n' -b "lixto_session=$token" 'localhost:3101/procurements?status=open'` → `200`, `grep -q 'Licitações' /tmp/p.html`; pick one `source_id` from the DB and `curl … "localhost:3101/procurement/$(python3 -c 'import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=""))' "$SID")"` → `200` with `grep -q 'Homologado'`.

## Done when
- List filters/facets/pagination and the detail page behave as the legacy ones on the new tables; no `licitacao`/`licitacoes`/`analise` identifiers remain in files you own.

## Not included
- Profile, match, tools, chat (82); auth/company pages (80); marketing page.
