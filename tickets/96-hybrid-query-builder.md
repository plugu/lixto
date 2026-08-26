---
id: 96
status: done
model: opus
depends_on: []
max_attempts: 3
files:
  - web/lib/procurement-queries.ts
  - web/lib/procurement-queries.test.ts
  - web/lib/agent/embed.ts
  - web/lib/agent/embed.test.ts
---
## Goal
`buildListQuery`/`buildCountQuery` accept an optional query embedding and, when present, retrieve FTS ∪ pgvector candidates ranked by reciprocal-rank fusion, plus one `embedQuery` helper callers use to turn free text into that embedding.

## Context

Today `buildFilterConditions` (procurement-queries.ts ~L168) puts the `filters.q` FTS predicate (description + `procurement_items`) in the WHERE. Keep that as the **keyword-only path** — it must stay byte-identical when no embedding is given (existing tests are the contract).

Add a 5th param `qEmbedding?: string | null` (pgvector text literal, `[0.1,...]`) to `buildListQuery`, `buildCountQuery`, `buildWhereClause` internals as needed, and `fetchProcurements`. When `filters.q && qEmbedding`, build the **hybrid path**:

- `structured` = all `buildFilterConditions` predicates **except** the q predicate (add an `omitQ` option to `buildFilterConditions`; `compat` predicate stays hard too).
- CTE `kw`: `SELECT procurements.id, row_number() OVER (ORDER BY ts_rank(...) DESC, id) AS rank FROM procurements WHERE structured AND <existing q predicate>`. Use `ts_rank(to_tsvector('portuguese', f_unaccent(coalesce(description,''))), websearch_to_tsquery('portuguese', f_unaccent($q)))`.
- CTE `sem`: `SELECT pe.procurement_id AS id, 1 - (pe.embedding <=> $v::vector) AS similarity, row_number() OVER (ORDER BY pe.embedding <=> $v::vector) AS rank FROM procurement_embeddings pe JOIN procurements ON procurements.id = pe.procurement_id WHERE structured ORDER BY pe.embedding <=> $v::vector LIMIT SEMANTIC_TOP_K` (export `SEARCH_SEMANTIC_TOP_K = 200`, `SEARCH_SEMANTIC_MIN = 0.4`, `RRF_K = 60` as constants from procurement-queries.ts; same values as match-queries.ts but do not import from it).
- CTE `fused`: `kw FULL OUTER JOIN sem USING (id)`, drop rows where `sem.similarity < SEARCH_SEMANTIC_MIN AND kw.id IS NULL`; `rrf = coalesce(1.0/(RRF_K+kw.rank),0) + coalesce(1.0/(RRF_K+sem.rank),0)`; `match_kind = CASE WHEN kw.id IS NOT NULL AND sem.id IS NOT NULL THEN 'both' WHEN kw.id IS NOT NULL THEN 'keyword' ELSE 'semantic' END`.
- List: existing `classified` SELECT joined to `fused`, `ORDER BY fused.rrf DESC, source_id`, LIMIT/OFFSET. Count: `SELECT count(*) FROM fused`.
- `ProcurementRow` gains `match_kind: "keyword" | "semantic" | "both" | null` and `similarity: string | number | null`; keyword-only path selects `NULL` for both. Facet queries are untouched (keyword-only; documented limitation).

In `web/lib/agent/embed.ts` add `export async function embedQuery(q: string): Promise<string | null>` = `embedText(q)` → `toPgVector(vector)`; null on any failure (embedText already never throws). Test it with the injected-client pattern used by the `embedText` tests.

Tests are pure builder tests (`q.text` contains/not-contains, param positions), like the existing `buildWhereClause` suite.

## Checks (run in order — cheapest first)
1. `cd web && npm run lint`
2. `cd web && npx tsc --noEmit`
3. `cd web && npx vitest run lib/procurement-queries.test.ts lib/agent/embed.test.ts`
4. `cd web && npm test`

## Done when
- `buildListQuery(f, 20, 0, undefined, "[...]")` with `f.q` set emits `kw`, `sem`, `fused` CTEs, `<=>`, `ORDER BY fused.rrf DESC`; without embedding the SQL equals today's.
- `buildCountQuery` with embedding counts `fused`; structured filters appear in both branches.
- `embedQuery("x")` returns a pgvector literal with an injected client, null without a key.

## Not included
- Calling `embedQuery` from tools or pages (tickets 97, 98).
- Facet counts on the hybrid candidate set.
- Any change to match-queries.ts or the match engine.
