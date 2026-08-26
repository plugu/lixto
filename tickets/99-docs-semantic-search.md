---
id: 99
status: todo
model: haiku
depends_on: [97, 98]
max_attempts: 3
files:
  - README.md
  - docs/ARCHITECTURE.md
  - docs/VISION.md
  - CLAUDE.md
---
## Goal
Docs describe query-time semantic search and the `enrich-embed` catch-up schedule.

## Context

Ground in code: `web/lib/procurement-queries.ts` (hybrid path: `kw`/`sem`/`fused` CTEs, constants `SEARCH_SEMANTIC_TOP_K`, `SEARCH_SEMANTIC_MIN`, `RRF_K`), `web/lib/agent/embed.ts` (`embedQuery`), `web/lib/agent/tools.ts` (`search_procurements`), `web/app/(app)/procurements/page.tsx`, `src/lixto/enrich/embed.py` (inline embed + `lixto enrich embed` backfill).

- `docs/ARCHITECTURE.md`: new subsection "Query-time semantic search" under the tools/search area: free text → `embedQuery` → FTS ∪ top-K cosine (≥0.4) → reciprocal-rank fusion (k=60) → structured filters hard in both branches; null embedding → keyword-only fallback; facets keyword-only. Remove "Query-time semantic search" from "Not Built Yet". Add `match_kind` to the `search_procurements` row of the tools table.
- `docs/VISION.md` appendix: move "Query-time semantic search" from "not built" to built (cycle 20); remove it from "Cycle 20+ roadmap" medium priority; add a "Cycle 20 — Query-time semantic search (built)" block after the cycle 19 one.
- `README.md`: one line in the CLI/search section explaining semantic search and that `lixto enrich embed` backfills missing vectors.
- `CLAUDE.md` (project): schedules table — `enrich-embed` line becomes `45 7,14,21 * * *` (15 min after `enrich-run`), keep note that it is created disabled until ingestion is enabled.

## Checks (run in order — cheapest first)
1. `grep -q "Query-time semantic search" docs/ARCHITECTURE.md && ! grep -q "Query-time semantic search\*\*: embed the user" docs/ARCHITECTURE.md`
2. `grep -q "Cycle 20 — Query-time semantic search" docs/VISION.md`
3. `grep -q "enrich embed" README.md`
4. `grep -q "45 7,14,21" CLAUDE.md`

## Done when
- ARCHITECTURE/VISION/README/CLAUDE.md reflect the shipped hybrid search and the embed schedule cadence.

## Not included
- Changing the Dokploy schedule itself (orchestrator step after the run).
- DATA_MODEL.md (no schema change).
