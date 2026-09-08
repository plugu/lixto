---
id: 128
status: done
model: sonnet
depends_on: [126]
max_attempts: 3
files:
  - web/lib/radar-detail-queries.ts
  - web/lib/radar-detail-queries.test.ts
  - web/lib/tenant-isolation.test.ts
  - web/app/(app)/radar/[id]/page.tsx
  - web/app/(app)/radar/[id]/actions.ts
  - web/components/radar-actions.tsx
  - web/components/radar-why.tsx
  - web/lib/radar-labels.ts
  - web/components/radar-card.tsx
---
## Goal
`/radar/[id]` shows one future opportunity with its evidence, a mandatory "Por que estamos mostrando isso?" breakdown, a link to the source on PNCP, and working Salvar / Ignorar actions that persist per company.

## Context
Cycle 24 Radar (PRODUCT.md). Tenant rule (`docs/TENANT.md`): the page is only reachable for opportunities the session company has a `future_opportunity_matches` row for — otherwise `notFound()`. `companyId`/`userId` always from `requireSession()` (`web/lib/auth.ts:164`), never from args.

**`web/lib/radar-detail-queries.ts`** (relative imports, `companyId` = `$1`):
- `fetchRadarDetail(companyId, id)` → `future_opportunities fo` JOIN `future_opportunity_matches m` (this company) LEFT JOIN `future_opportunity_actions a`, JOIN `agencies ag`, JOIN `procurement_plans p` (`source_id, year, unit_name, unit_code, published_at, source_global_updated_at`), LEFT JOIN **live** `procurement_plan_items i ON (i.plan_id, i.item_number) = (fo.plan_id, fo.item_number)` for `pdm_description, catalog_classification_name, superior_classification_name, estimated_quantity, unit_value, supply_unit, requesting_unit, contracting_group_name, source_updated_at`; LEFT JOIN `agency_units u` on `(p.agency_tax_id, p.unit_code)` for `city_name`. Returns null when no match row.
- `buildSetRadarAction(companyId, id, userId, state: "saved" | "ignored"): SqlQuery` — upsert into `future_opportunity_actions` guarded by ownership: `INSERT ... SELECT $1, fo.id, $3, $4 FROM future_opportunities fo JOIN future_opportunity_matches m ON m.future_opportunity_id = fo.id AND m.company_id = $1 WHERE fo.id = $2 ON CONFLICT (company_id, future_opportunity_id) DO UPDATE SET state = EXCLUDED.state, user_id = EXCLUDED.user_id, updated_at = now()` (idiom: `opportunity-queries.ts:233`). `buildClearRadarAction(companyId, id)` deletes the row. Async wrappers `setRadarAction`, `clearRadarAction`. Register both builders in `web/lib/tenant-isolation.test.ts`.
- `pncpPlanUrl(agencyTaxId, year, sourceId)`: parse the trailing sequence from `source_id` (`/^\d{14}-\d-(\d+)\/\d{4}$/` → group 1 as integer) and return `https://pncp.gov.br/app/pca/${agencyTaxId}/${year}/${seq}`; if the pattern does not match return `https://pncp.gov.br/app/pca` and let the UI show the raw `source_id` next to the link. Verify the pattern against a real `procurement_plans.source_id` in the dev DB and adjust the regex if PNCP's format differs — leave a comment with one real example.

**Page** `web/app/(app)/radar/[id]/page.tsx` — server component patterned on `web/app/(app)/procurement/[sourceId]/page.tsx` (`Card`/`CollapsibleCard`, local `Fact`, `BackLink` to `/radar`). Sections, pt-BR, hedged language ("compra prevista", "provável"):
1. Header: title, agency + unit + `state`/`city_name`, badges "Probabilidade {opportunity_score}" / "Aderência {match_score}", action badge, `<RadarActions>`.
2. Resumo: valor estimado (`formatCurrencyBRL`), quantidade + unidade, data prevista (`formatDateBR`) or "não informada", ano do PCA, PDM/classificação, unidade requisitante.
3. Labels: ticket 127 left the pt-BR label maps for `SignalCode`/`ReasonCode` local to `web/components/radar-card.tsx` — move them into a new `web/lib/radar-labels.ts` (`SIGNAL_LABELS`, `REASON_LABELS`, exported) and import from both the card and `RadarWhy`; no other change to the card.
   `<RadarWhy signals={fo.signals} reasons={m.reasons} opportunityScore matchScore />` — **mandatory**: two tables (Probabilidade / Aderência) listing each `{code → pt-BR label, weight, detail}` with totals; intro line "Esta oportunidade aparece porque…" generated from the labels (no LLM).
4. Evidência: card "Plano Anual de Contratações" with `source_id`, `published_at`, `source_global_updated_at`, item `source_updated_at`, and `LinkButton` "Ver no PNCP" → `pncpPlanUrl(...)` (`target="_blank" rel="noopener"`). If the live item row is missing, show "Item não está mais no PCA atual" (opportunity may be expiring).
5. Placeholder card "Análise com IA" containing only text "Disponível em breve" (ticket 129 replaces it).

**Actions** `web/app/(app)/radar/[id]/actions.ts` (`"use server"`, shape of `web/app/(app)/opportunities/actions.ts`): `saveRadarAction(id)`, `ignoreRadarAction(id)`, `clearRadarAction(id)`; each validates `Number.isInteger(id)`, calls the query wrapper, `revalidatePath("/radar")` and `revalidatePath(`/radar/${id}`)`, returns `{ ok: true } | { error }`. **`web/components/radar-actions.tsx`** client component (`useTransition`, like `components/opportunity-feedback.tsx`): props `{ id, actionState }`; renders "Salvar" / "Ignorar" (`Button` secondary, sm) or, when already acted, the state plus "Desfazer".

## Checks (run in order — cheapest first)
1. `cd web && npm run lint`
2. `cd web && npx vitest run lib/radar-detail-queries.test.ts lib/tenant-isolation.test.ts`
3. `cd web && npm run build`
4. `cd web && npm test`
5. `curl -s -o /dev/null -w "%{http_code}" -b "lixto_session=<dev cookie>" localhost:3000/radar/<matched id> | grep -q 200 && curl -s -o /dev/null -w "%{http_code}" -b "lixto_session=<dev cookie>" localhost:3000/radar/999999999 | grep -q 404`

## Done when
- Opening a card from `/radar` shows summary, the two "why" tables whose weights sum to the displayed scores, the PCA evidence card with a PNCP link, and Salvar/Ignorar; after clicking Ignorar and reloading, the badge reads "Ignorada", the item is gone from `/radar` and present under `/radar?view=ignored`; Desfazer reverts.
- An id belonging to another company's match (or none) renders 404.

## Not included
- "Analisar com IA" (ticket 129) — placeholder only.
- Notes, alerts, follow, 👍/👎 feedback.
- Historical procurement / price tables (V2/V3).
