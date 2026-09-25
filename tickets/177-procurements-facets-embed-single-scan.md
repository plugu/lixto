---
id: 177
status: done
model: opus
depends_on: [175]
max_attempts: 3
files:
  - web/lib/procurement-queries.ts
  - web/lib/procurement-queries.test.ts
  - web/lib/agent/embed.ts
  - web/lib/agent/embed.test.ts
  - web/components/procurements/results.tsx
---
## Goal
`/procurements` serves facet counts and modality options from the `sync`-tagged memo, embeds a given search text once per process, and fetches rows + total in one statement (one HNSW scan on the hybrid path, not two).

## Context
Per view today: `fetchModalityOptions()` (`web/lib/procurement-queries.ts:555-563`, `SELECT DISTINCT modality_id, modality_name FROM procurements` with **no** `ACTIVE_PORTALS` filter, awaited before first paint in `procurements/page.tsx:36`), `fetchFacetCounts(filters)` (5 parallel GROUP BY queries, `:726`, all carrying the filters including the `q` FTS predicate, never the company/compat predicate — see the `:292-296` comment), `fetchProcurements` (`:678`, list + count in parallel; on the hybrid path both `buildListQuery` and `buildCountQuery` build the same CTEs via `buildHybridCtes`, so the `sem` CTE's `ORDER BY embedding <=> $v LIMIT 200` runs twice). `web/components/procurements/results.tsx:42` calls `embedQuery(filters.q)`; the Suspense boundary is keyed on `filters#page`, so paging re-embeds the same text. `embedText`/`embedQuery` in `web/lib/agent/embed.ts:52-102` accept an injected client (`deps.client`) — tests use `fakeClient`. Ticket 175 provides `cached`, `stableKey`, `CACHE_TAGS`, `resetCache` in `web/lib/cache.ts` (lib tests import relatively: `./cache`, `../cache`). Category facets also move when `analyze-jobs` writes categories every 2 min; the TTL bounds that staleness (accepted).

### Work
1. `buildModalityOptionsQuery()`: add `WHERE origin_system = ANY($1)` (keep the two `IS NOT NULL` conditions), `values: [ACTIVE_PORTALS]`; update its test if one exists, else add one.
2. `fetchModalityOptions()` → `cached("procurements:modality-options", { tags: [CACHE_TAGS.sync] }, …)`. `fetchFacetCounts(filters)` → `cached(\`procurements:facets:${stableKey(filters)}\`, { tags: [CACHE_TAGS.sync] }, …)`; `stableKey` makes `{q, states}` and `{states, q}` the same key. Body/SQL unchanged.
3. One statement for rows + total: in `buildListQuery`, add `count(*) OVER ()::text AS total` to the final SELECT of **both** paths (hybrid: from `classified JOIN fused`; keyword: from `classified`). In `fetchProcurements`, run only the list query; `total = Number(rows[0]?.total ?? 0)`; when `rows.length === 0 && offset > 0` (page past the end) fall back to `buildCountQuery` so the pagination still knows the real total. Strip `total` from the returned rows (return type `ProcurementRow[]` unchanged). Keep `buildCountQuery` exported and tested. Tests: both list variants contain `count(*) OVER ()`; the hybrid list still contains exactly one `LIMIT ${SEARCH_SEMANTIC_TOP_K}`.
4. `embed.ts`: memoise `embedQuery` results in a module-level `Map<string, string>` keyed `${model}:${normalised q}` where normalised = trim, lowercase, whitespace collapsed to one space. Only successful (non-null) literals are stored. Bound: `LIXTO_WEB_EMBED_CACHE_SIZE` (default `500`), FIFO eviction. Export `resetEmbedCache()` for tests. `embedText` itself stays uncached (profile saves go through it and ticket 178 handles that path).
5. `embed.test.ts`: two `embedQuery` calls with the same text (different whitespace/case) → `create` called once; a null result is not cached (second call embeds again); `resetEmbedCache()` in `afterEach` so the existing tests keep their call-count assertions.
6. `results.tsx`: update the comment (embedding memoised per process; rows + total are one statement). Behaviour otherwise unchanged.

## Checks (run in order — cheapest first)
1. `cd web && npm run lint`
2. `cd web && npx tsc --noEmit`
3. `cd web && npx vitest run lib/procurement-queries.test.ts lib/agent/embed.test.ts`
4. `cd web && npx vitest run`
5. `cd web && grep -c 'count(\*) OVER ()' lib/procurement-queries.ts | grep -qx 2`

## Done when
- All checks green; facets and modality options are served through `cached` under tag `sync`; the modality options query is portal-filtered; a repeated search text does not call the embeddings API; `fetchProcurements` issues one statement on the happy path.

## Not included
- Caching the list rows or per-company `getCompanyCnaes`; changing `SEARCH_SEMANTIC_TOP_K`, RRF, or ranking; the ⌘K palette search; docs (181).
