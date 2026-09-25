---
id: 179
status: done
model: sonnet
depends_on: []
max_attempts: 3
files:
  - web/lib/match-queries.ts
  - web/lib/match-queries.test.ts
---
## Goal
The match batch's candidate query uses the FTS GIN indexes (no OR-EXISTS) and its semantic top-K only spends slots on rows the batch can keep.

## Context
`web/lib/match-queries.ts`: `ftsHit(param)` (`:135-144`) is `CASE WHEN param IS NULL THEN false ELSE (to_tsvector(...p.description...) @@ to_tsquery(...) OR EXISTS (SELECT 1 FROM procurement_items i WHERE i.procurement_id = p.id AND to_tsvector(...i.description...) @@ to_tsquery(...))) END`, used for `text_hit`, `exclusion_hit` and inside the "at least one signal" WHERE (`:250`). `filters.q` (`:229-235`) has the same OR-EXISTS shape with `websearch_to_tsquery`. The OR keeps the planner off `idx_procurements_description_fts` / `idx_procurement_items_description_fts` (~5 s per query on prod, memory 2026-09-21). The fixed shape shipped for `/procurements` in `procurement-queries.ts:127-138` (`buildQPredicate`): `procurements.id IN (SELECT kw_p.id FROM procurements kw_p WHERE <fts> UNION SELECT kw_i.procurement_id FROM procurement_items kw_i WHERE <fts>)` — expressions must stay textually identical to the index definitions (`to_tsvector('portuguese', f_unaccent(coalesce(x.description, '')))`). The semantic CTE (`:171-181`) is `SELECT procurement_id, 1 - (embedding <=> $v::vector) AS similarity FROM procurement_embeddings ORDER BY … LIMIT ${SEMANTIC_TOP_K}` with no join/filter, then `LEFT JOIN semantic s`; the outer WHERE keeps only `ACTIVE_PORTALS` + `open|upcoming` (`STATUS_PREDICATES`), so closed rows can fill the K slots. Tests in `match-queries.test.ts` assert on SQL text (`toContain("semantic AS (")`, `"LEFT JOIN semantic s"`).

### Work
1. Rewrite `ftsHit(param)` to keep the `CASE WHEN ${param}::text IS NULL THEN false ELSE (...) END` guard and replace the inner OR-EXISTS with `p.id IN (SELECT kw_p.id FROM procurements kw_p WHERE to_tsvector('portuguese', f_unaccent(coalesce(kw_p.description, ''))) @@ to_tsquery('portuguese', f_unaccent(${param}::text)) UNION SELECT kw_i.procurement_id FROM procurement_items kw_i WHERE to_tsvector('portuguese', f_unaccent(coalesce(kw_i.description, ''))) @@ to_tsquery('portuguese', f_unaccent(${param}::text)))`. Update the comment to say why (same rationale as `buildQPredicate`).
2. Rewrite the `filters.q` condition the same way with `websearch_to_tsquery`.
3. Semantic CTE: join `procurements sp ON sp.id = procurement_embeddings.procurement_id` and add `WHERE sp.origin_system = ANY(<ACTIVE_PORTALS bind>) AND (<the same status predicates the outer query uses>)` before `ORDER BY … LIMIT`. Reuse the already-bound `ACTIVE_PORTALS` parameter and build the status predicate string once and use it in both places (prefix columns correctly: `sp.` inside the CTE, `p.` outside — `STATUS_PREDICATES` strings must be parameterised by alias or written for both).
4. Tests: no `OR EXISTS` anywhere in the built text; the UNION shape appears for `text_hit`, `exclusion_hit` and `q`; the semantic CTE contains `origin_system = ANY(` and the open/upcoming predicate; existing assertions still pass; bound values order unchanged where tests pin it.

## Checks (run in order — cheapest first)
1. `cd web && npm run lint`
2. `cd web && npx tsc --noEmit`
3. `cd web && npx vitest run lib/match-queries.test.ts lib/match-batch.test.ts lib/match-engine.test.ts`
4. `cd web && ! grep -q 'OR EXISTS' lib/match-queries.ts`

## Done when
- All checks green; every FTS predicate in the candidate query is the `id IN (… UNION …)` shape; the semantic top-K is restricted to allowed portals and open/upcoming rows.

## Not included
- `SEMANTIC_TOP_K`/`SEMANTIC_MIN` values, the enrichedSince watermark, `insertMatch` growth, anything in `match-batch.ts` or `match-engine.ts`.
