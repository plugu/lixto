---
id: 187
status: done
model: haiku
depends_on: [182, 183, 184, 185, 186]
max_attempts: 3
files:
  - README.md
  - docs/ARCHITECTURE.md
  - docs/DATA_MODEL.md
  - CLAUDE.md
  - .env.example
  - STATE.md
---
## Goal
Docs, env tables, schedules and STATE.md describe cycle 32 exactly as built; graph refreshed.

## Context
Built in 182–186: migration `009_classification.sql` (`classification_segments` seed of 24, `cnae_code_embeddings`, `procurement_classifications`, `procurement_cnaes.origin` ∈ {enrichment, ingest}); CLI `lixto classify embed-labels [--force]`, `lixto classify run [--limit] [--retry-errors]` (ends with a best-effort cache revalidate), `lixto classify export --limit --out`; env `LIXTO_CLASSIFY_DAILY_CAP` (0/unset = unlimited) and `LIXTO_CLASSIFY_MODALITIES` (default `6,8`), both CLI-only; `lixto status` `classification:` block; analyze worker keeps ingest CNAEs; web match reads classification keywords, item-derived ME/EPP, `signalsSince`, `MATCH_ENGINE_VERSION = "2"`; `/procurements` `segment` param + facet replaces `category`; detail page Classificação card. Prod rollout (manual, by the owner): `lixto db init`, `lixto cnae seed` if `cnae_codes` is empty, `lixto classify embed-labels`, then change the Dokploy `sync-incremental` command to `lixto sync incremental --max-details 2000; lixto enrich embed; lixto classify run`, then one backfill `lixto classify run --limit 5000` repeated until `classify_pending` is 0, then `lixto classify export --limit 100` for the review sample. README anchors: "Environment Variables" table (~91), "CLI Commands" (~133; add a `### Classification (Cycle 32)` block before "Users & access"), "Production Schedules" row `sync-incremental` (~208). ARCHITECTURE anchors: "Pipeline Overview" (5), "Match Engine" rules table (82-114: `me_epp_exclusive` source, `term_enrichment` source), "Enrichment Schema" (302); add `## Classification at ingest (Cycle 32)` before "Tender Analysis (Cycle 25)". DATA_MODEL: `procurement_cnaes` section (121) + new table sections. CLAUDE.md: env table (~55 after `LIXTO_ENRICH_DAILY_CAP`), Key Code Locations table, schedules bullet for `sync-incremental`.

### Work
1. README: env rows; CLI block; schedule row command text + "LLM $" stays **yes**; one sentence in "Troubleshooting" ("No matches for a company with CNAEs?" → check `lixto status` `classify_pending`).
2. ARCHITECTURE: pipeline line `[classify.run] CNAE/segment/keywords for open tenders (cosine candidates + CHEAP choice)`; the new section (what, inputs, candidate retrieval, prompt contract, write rules incl. origin precedence, cap, cost per tender, what it is not: no dossier, no weights); match table updates; env list.
3. DATA_MODEL: new tables with columns; `procurement_cnaes.origin` values and precedence.
4. CLAUDE.md: env rows; Key Code Locations rows `| Classification at ingest | src/lixto/classify/*.py (taxonomy, labels, worker, export); CLI src/lixto/cli/classify.py; web/lib/classification-queries.ts; migrations/009_classification.sql |`; schedules bullet for `sync-incremental` mentions the trailing `; lixto classify run`.
5. `.env.example`: the two vars with one-line comments.
6. STATE.md rewrite (≤30 lines, never append): Now = cycle 32 (classification at ingest, mvp) 182–187 done, awaiting approval 2 of 2 + deploy; Next = commit + push, the prod rollout steps above in order, the owner's 100-row review (≥80% CNAE top-1, ≥90% segment), verify `/opportunities` reasons and `/procurements?segment=`; carry over the still-open items from the current STATE.md; Decisions = cosine candidates + CHEAP choice, closed 24-segment taxonomy seeded by migration, keywords on `procurement_classifications`, dossier CNAE wins on shared code, `MATCH_ENGINE_VERSION` 2, batch match keyed on `signalsSince`, Comprasnet scraper (`lixto comprasnet scrape`, Camoufox) shipped as operator tool, token-reuse branch untested.
7. `graphify update .`

## Checks (run in order — cheapest first)
1. `grep -q 'LIXTO_CLASSIFY_DAILY_CAP' README.md && grep -q 'LIXTO_CLASSIFY_MODALITIES' CLAUDE.md && grep -q 'lixto classify run' README.md && grep -q 'LIXTO_CLASSIFY_DAILY_CAP' .env.example`
2. `grep -q 'Classification at ingest (Cycle 32)' docs/ARCHITECTURE.md && grep -q 'procurement_classifications' docs/DATA_MODEL.md && grep -q 'classification-queries.ts' CLAUDE.md`
3. `test "$(wc -l < STATE.md)" -le 30 && grep -q 'Cycle 32' STATE.md`
4. `graphify update . > /dev/null && test -f graphify-out/GRAPH_REPORT.md`

## Done when
- Every statement matches the code shipped in 182–186; no planned-but-unbuilt behaviour described as built.

## Not included
- ADRs; code changes; Dokploy edits; running the prod rollout.
