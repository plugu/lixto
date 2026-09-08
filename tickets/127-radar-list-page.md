---
id: 127
status: done
model: sonnet
depends_on: [126]
max_attempts: 3
files:
  - web/lib/radar-list-queries.ts
  - web/lib/radar-list-queries.test.ts
  - web/app/(app)/radar/page.tsx
  - web/components/radar-card.tsx
  - web/components/sidebar.tsx
  - web/components/ui/top-bar.tsx
  - web/components/ui/icons.tsx
---
## Goal
`/radar` lists the session company's matched future opportunities, ranked by score, with filters, pagination, a value headline and a "Radar" entry in the navigation.

## Context
Cycle 24 Radar (PRODUCT.md). Data comes from `future_opportunities fo JOIN future_opportunity_matches m ON m.future_opportunity_id = fo.id AND m.company_id = $1`, `LEFT JOIN future_opportunity_actions a` (same pair), `JOIN agencies ag ON ag.tax_id = fo.agency_tax_id`, `JOIN procurement_plans p ON p.id = fo.plan_id` (for `unit_name`). Only `fo.status = 'predicted'`. UI copy is pt-BR, and never states a purchase as certain ("compra prevista", "provável", "estimado").

**`web/lib/radar-list-queries.ts`** — follow the pure-builder style of `web/lib/procurement-queries.ts` (`SqlQuery`, `parseFilters`-like parser that drops invalid values, `companyId` bound as `$1`, relative imports):
- `type RadarFilters = { view: "all" | "saved" | "ignored"; states: string[]; period: 30|60|90|180|365|null; minValue: number|null; maxValue: number|null; minScore: number|null }`; `parseRadarFilters(raw)`; default `view = "all"` **excludes** ignored rows; `saved`/`ignored` restrict to that action state.
- `buildRadarListQuery(companyId, filters, limit, offset)` — select `fo.id, fo.title, fo.state, fo.estimated_value, fo.expected_date, fo.plan_year, fo.opportunity_score, fo.signals, m.match_score, m.reasons, a.state AS action_state, ag.name AS agency_name, p.unit_name`; `period` → `fo.expected_date <= current_date + N` (NULL dates only when period is null); order `m.match_score DESC, fo.opportunity_score DESC, fo.expected_date ASC NULLS LAST, fo.id`.
- `buildRadarCountQuery(companyId, filters)` → `{ total, total_value }` (`sum(fo.estimated_value)`) over the same WHERE.
- `buildRadarStateOptionsQuery(companyId)` — distinct `fo.state` for this company's matches, for the state select.
- Async wrappers `fetchRadarList`, `fetchRadarSummary`, `fetchRadarStateOptions` on `pool`.

**Page** `web/app/(app)/radar/page.tsx` — server component like `web/app/(app)/procurements/page.tsx` (`PageProps<"/radar">`, `requireSession()`, `PAGE_SIZE = 25`, `page` param, its `Pagination` pattern and query-string builder — copy locally, don't import from the other page). Headline: `"{formatCurrencyBRL(total_value)} em compras públicas previstas para os próximos {period ?? 365} dias que combinam com a sua empresa"` + `{total} oportunidades`. Filters row (`Select`/`Input`/`Label` from `components/ui/input.tsx`, `Toolbar` from `ui/toolbar.tsx`): view tabs (Todas / Salvas / Ignoradas) as pill `Link`s like `/opportunities`; state select; period select; min/max value; min match score. Empty state via `EmptyState` with hint "Rode a sincronização de PCA e o radar, ou ajuste o perfil da empresa".

**Card** `web/components/radar-card.tsx` — server component modeled on `web/components/opportunity-card.tsx`: two badges "Probabilidade {opportunity_score}" and "Aderência {match_score}" (copy `scoreTone`), agency name + unit, title (link to `/radar/${id}` — page ships in 128), `formatCurrencyBRL(estimated_value)`, "Previsto para {formatDateBR(expected_date)}" (or "Data não informada · PCA {plan_year}"), top 3 signal/reason chips with pt-BR labels for every `SignalCode` and the `ReasonCode`s the radar uses (`term_text, semantic_high, semantic, state_ok, state_out, value_ok, value_out, value_unknown, exclusion, no_profile`), a small "Salva"/"Ignorada" badge from `action_state`.

**Nav**: add `{ href: "/radar", label: "Radar", icon: Radar }` to `NAV_ITEMS` in `components/sidebar.tsx:71` (mobile nav in `ui/top-bar.tsx` reads the same array — verify it renders). Add a `Radar` SVG icon to `components/ui/icons.tsx` following the existing `({ size = 16, ...props }: IconProps)` signature (concentric arcs + sweep line, stroke-based like the others). Extend `isActive` (`sidebar.tsx:87`) so `/radar/*` highlights `/radar`.

## Checks (run in order — cheapest first)
1. `cd web && npm run lint`
2. `cd web && npx vitest run lib/radar-list-queries.test.ts`
3. `cd web && npm run build`
4. `cd web && npm test`
5. `curl -s -o /dev/null -w "%{http_code}" -b "lixto_session=<dev cookie>" localhost:3000/radar | grep -q 200` (dev server, logged-in cookie from the browser)

## Done when
- Logged in as a company with matches (ticket 126 run), `/radar` shows cards ranked by match score with the value headline; `?view=saved`, `?state=RJ`, `?period=90`, `?minScore=60`, `?page=2` each narrow/paginate the list and the headline totals follow the filters.
- "Radar" appears in sidebar and mobile nav and is highlighted on `/radar`.

## Not included
- Detail page, save/ignore actions (128) — card links may 404 until then.
- AI analysis (129), docs (130).
- Filters by agency, city, category, signal source (V2).
