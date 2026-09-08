---
id: 136
status: done
model: haiku
depends_on: [133, 135]
max_attempts: 3
files:
  - CLAUDE.md
  - AGENTS.md
  - README.md
  - docs/ARCHITECTURE.md
  - docs/DATA_MODEL.md
  - .env.example
  - web/.env.example
  - docs/product/PRODUCT-cycle25.md
---
## Goal
Docs, env examples and the schedule table describe `lixto analyze` (run + jobs), the dossier tables and the new env vars; no doc still tells an operator to run `lixto enrich run`.

## Context
Cycle 25 (PRODUCT.md). Shipped by tickets 131–135: `migrations/006_tender_analysis.sql` (9 tables: `procurement_document_pages`, `tender_analyses`, `tender_analysis_facts/dates/requirements/penalties/risks/missing`, `analysis_jobs`); `src/lixto/analyze/{schema,prompt,worker,jobs}.py`; CLI `lixto analyze run [--limit N] [--days N] [--retry-errors]` and `lixto analyze jobs [--limit N]`; `lixto enrich run` removed (`lixto enrich embed` stays); `src/lixto/enrich/documents.py` now extracts every active PDF per page; web: `web/lib/analysis-queries.ts`, `analysis-labels.ts`, `components/analysis-panel.tsx`, `citation-link.tsx`, `analyze-button.tsx`, `enrichment-panel.tsx` deleted. Read those files for exact names; do not describe behaviour they don't have.

Edits (exact spots — grep the strings):
- **CLAUDE.md**: schedules list — replace `enrich-run` with `analyze-run — 30 7,14,21 * * * (deep analysis of fenced procurements: facets + dossier, up to daily cap)`; add `analyze-jobs — */2 * * * * (drain on-demand "Analisar com IA" queue)`. Env table: add `LIXTO_ANALYZE_MAX_BYTES` (default 60 MB), `LIXTO_ANALYZE_MAX_CHARS` (default 400000), `LIXTO_ANALYZE_USER_DAILY_CAP` (web, default 10); reword `LIXTO_ENRICH_DAILY_CAP` as "Max analyses/day (cron)". Key Code Locations: `Enrichment` row → `Analysis worker | src/lixto/analyze/worker.py (LLM routing, facets + dossier)`, add `Analysis UI | web/components/analysis-panel.tsx`, `Analysis queries | web/lib/analysis-queries.ts`. Example CLI line `lixto enrich run` → `lixto analyze run`.
- **AGENTS.md** lines ~36–37, ~64, ~83: same renames; add the dossier tables to the table list.
- **README.md** lines ~62–66, ~107, ~130–131, ~148, ~165–168 (schedule table: `analyze-run` + new `analyze-jobs` row), ~290 ("Drain enrichment" → "Drain analysis").
- **docs/ARCHITECTURE.md**: pipeline block lines ~18–22 (`[analyze.run]` producing enrichment facets + `tender_analyses`), routing paragraph ~47 (doc tier over page-tagged text of all PDFs; `pdf` fallback; `structured` cheap), cost fence ~57–68 (`lixto analyze run`; on-demand jobs bypass the global cap but are capped per company), tiers table ~38 (Doc tier row now "Tender analysis"). Add a short "Tender analysis (cycle 25)" subsection after the enrichment one: one pass, schema 2.0, fact/inference/missing guardrail, citations `(sequence, page)`, `document_set_hash`, on-demand queue.
- **docs/DATA_MODEL.md**: `procurement_document_texts` (~77) note per-page rows in `procurement_document_pages`; new section per new table in the style of the existing ones (purpose, notable columns, written by).
- **.env.example**: after `LIXTO_ENRICH_DAILY_CAP=1500` add the two `LIXTO_ANALYZE_MAX_*` with comments. **web/.env.example**: add `LIXTO_ANALYZE_USER_DAILY_CAP=10`.
- **docs/product/PRODUCT-cycle25.md**: copy of the current `PRODUCT.md` (same convention as `PRODUCT-cycle21.md`).
Do not edit `docs/VISION.md`, `docs/PNCP_API.md`, or ADRs.

## Checks (run in order — cheapest first)
1. `! grep -rn "lixto enrich run\|enrich-run\|enrich/worker.py\|enrichment-panel" CLAUDE.md AGENTS.md README.md docs/ARCHITECTURE.md docs/DATA_MODEL.md .env.example web/.env.example`
2. `grep -q "analyze-jobs" CLAUDE.md && grep -q "analyze-jobs" README.md && grep -q "LIXTO_ANALYZE_USER_DAILY_CAP" web/.env.example && grep -q "tender_analyses" docs/DATA_MODEL.md`
3. `test -f docs/product/PRODUCT-cycle25.md && diff -q PRODUCT.md docs/product/PRODUCT-cycle25.md`
4. `graphify update . >/dev/null 2>&1; test -f graphify-out/GRAPH_REPORT.md`

## Done when
- An operator reading README/CLAUDE.md can create the `analyze-run` and `analyze-jobs` Dokploy schedules and set the three new env vars without opening the code.

## Not included
- Creating the Dokploy schedules or changing prod env (ops, done at deploy).
- Any code change; STATE.md (forge:run owns it).
