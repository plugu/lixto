---
id: 186
status: done
model: sonnet
depends_on: [182]
max_attempts: 3
files:
  - web/lib/procurement-queries.ts
  - web/lib/procurement-url.ts
  - web/lib/classification-queries.ts
  - web/components/filters.tsx
  - web/components/filter-chips.tsx
  - web/components/procurements/facet-toolbar.tsx
  - web/components/procurement/classification-card.tsx
  - web/app/(app)/procurement/[sourceId]/page.tsx
  - web/lib/procurement-queries.test.ts
  - web/lib/procurement-url.test.ts
  - web/lib/classification-queries.test.ts
---
## Goal
`/procurements` filters and counts by segment (closed list, pt-BR labels from the DB) instead of the free-text category, and the procurement page shows the ingest classification.

## Context
`web/lib/procurement-queries.ts`: `ProcurementFilters.categories` (35-55), `MultiFilterKey` (58-63), `FacetCounts.category` (76-82), `parseFilters` reads repeated `category` (174-175), category filter condition (264-273), `buildCategoryFacetQuery` (601-615, label = raw value), `loadFacetCounts` (777-844) under `cached(…, { tags: [CACHE_TAGS.sync] })`. `web/lib/procurement-url.ts` serialises/parses `category` (44, 130-131); its test fixture has `categories: ["Alimentação", "Serviços gerais"]` and an equivalence test against `parseFilters`. UI: `components/filters.tsx:56, 473-479` (`<MultiSelect label="Categoria" …>`), `components/filter-chips.tsx:65-76`, `components/procurements/facet-toolbar.tsx:23-29` (`EMPTY_FACET_COUNTS`). Detail page `app/(app)/procurement/[sourceId]/page.tsx` (sidebar 159-197, `fetchEnrichment` at 51, `detail.id` is the numeric id). Tables from ticket 182: `procurement_classifications (procurement_id, status, segment, segment_confidence, nature, keywords, classified_at)`, `classification_segments (code, label, sort_order)`, `procurement_cnaes (cnae_code, confidence, origin)`, `cnae_codes (code, description)`. Test style: `procurement-queries.test.ts` asserts exact WHERE strings (296-299, 395, 726-733) and facet cache keys (860-881).

### Work
1. `procurement-queries.ts`: replace `categories` with `segments?: string[]` everywhere (`ProcurementFilters`, `MultiFilterKey` value `"segments"`, `parseFilters` reads repeated `segment`); filter condition `EXISTS (SELECT 1 FROM procurement_classifications pcl WHERE pcl.procurement_id = procurements.id AND pcl.status = 'done' AND pcl.segment = ANY($n))`; `buildSegmentFacetQuery(filters)` → `SELECT s.code AS value, s.label AS label, count(*)::text AS count FROM procurements JOIN procurement_classifications pcl ON pcl.procurement_id = procurements.id AND pcl.status = 'done' JOIN classification_segments s ON s.code = pcl.segment WHERE … GROUP BY s.code, s.label, s.sort_order ORDER BY count(*) DESC, s.sort_order`; `FacetCounts.segment` replaces `category`; delete `buildCategoryFacetQuery` and every `procurement_categories` reference in this file. Keep the `compat` CNAE predicate unchanged.
2. `procurement-url.ts`: param `segment` instead of `category`; update `procurement-url.test.ts` fixture (`segments: ["informatica", "saude"]`) and the `getAll("segment")` assertion.
3. UI: `filters.tsx` → `<MultiSelect label="Segmento" options={facetCounts.segment} selected={active.segments ?? []} …>`, count in `countActiveFilters`; `filter-chips.tsx` chips keyed `segment-${code}` with the label looked up from `facetCounts.segment` (fall back to the code); `facet-toolbar.tsx` `EMPTY_FACET_COUNTS.segment`.
4. `web/lib/classification-queries.ts`: `fetchClassification(procurementId: number): Promise<ClassificationRow | null>` → `{ segment, segment_label, segment_confidence, nature, keywords, classified_at, cnaes: { code, description, confidence, origin }[] }` (CNAEs ordered by `origin = 'enrichment'` first, then confidence desc; description via `LEFT JOIN cnae_codes`); `NATURE_LABELS: Record<"bens"|"servicos"|"obras", string>` = Bens / Serviços / Obras. Test with the mocked pool: SQL joins `classification_segments` and `cnae_codes`, returns null when no row.
5. `components/procurement/classification-card.tsx` (server component, props `classification: ClassificationRow | null`): card titled "Classificação" showing segment label, nature label, up to 3 CNAEs as `code — description` with confidence %, keywords as small chips; renders nothing when null. Mount it in the detail page sidebar below the existing text blocks; load with `fetchClassification(detail.id)` in the same `Promise.all` as `fetchEnrichment`.
6. Tests in `procurement-queries.test.ts`: replace every category expectation with the segment equivalents (filter string, `pc.segment = ANY($5)` placement, facet query without the segment filter, values `[ACTIVE_PORTALS, ["SP"]]`), and assert `procurement_categories` no longer appears in `buildListQuery` output.

## Checks (run in order — cheapest first)
1. `cd web && npm run lint`
2. `cd web && npx tsc --noEmit`
3. `cd web && npx vitest run lib/procurement-queries.test.ts lib/procurement-url.test.ts lib/classification-queries.test.ts`
4. `cd web && npx vitest run`
5. `cd web && ! grep -rn "procurement_categories" lib components app --include=*.ts --include=*.tsx | grep -v enrichment-queries.ts`

## Done when
- `/procurements?segment=informatica` lists only tenders classified `informatica`; the facet shows pt-BR labels with counts; the chip reads "Informática e telecom".
- A classified tender's page shows the Classificação card; an unclassified one shows nothing extra.

## Not included
- Match engine/queries (185); `fetchEnrichment` categories array (still used by nothing visible — leave it); a segment filter on `/opportunities` or Radar; label editing UI; Python code.
