---
mode: prototype
routing_profile: cloud
parallel_default: sequential
---

# Lixto — ML-instead-of-LLM facet benchmark (cycle 26)

## What / why
Every enriched procurement costs an LLM call, and the provider question blocks Radar go-live. Most facets the match engine consumes are classification, not generation: `cnae_candidates`, `categories`, `requires_certification`, `requires_technical_certificate`, `complexity`, `keywords`/`concepts`, the embedding vector. Prod holds LLM-labelled `procurement_enrichments` rows plus PNCP CATMAT/CATSER item codes — free training labels. Measure whether cheap ML (TF-IDF + linear models, YAKE/KeyBERT, a local multilingual embedding model on the M4) reproduces the LLM, and what it costs, before touching the pipeline.

Throwaway code under `experiments/ml-facets/` with its own dependencies; `src/lixto` and `web/` untouched. Prod data pulled read-only over the Tailscale/socat bridge into a local scratch dataset. Step zero: fewer than ~1,000 labelled rows → stop and report.

## Primary user story
As the Lixto owner choosing an LLM provider, I run one script and read a per-facet report: does ML match the LLM closely enough to replace it, and what does it save per 1,000 procurements.

## Out of scope
- Dossier, summary, GO/NO-GO, Radar "Analisar com IA" (generative — stay LLM)
- Changes to `src/lixto`, `web/`, migrations, schedules, stored vectors
- Deep models / fine-tuning / GPU
- Production inference path (next cycle if numbers pass)

## Success demo
Done when `uv run experiments/ml-facets/bench.py` writes `experiments/ml-facets/REPORT.md` with, per target, held-out score vs LLM labels (thresholds: CNAE top-3 ≥80%, categories & flags F1 ≥0.8, keywords Jaccard ≥0.5, embeddings top-10 overlap ≥70%), coverage, ms/row on the M4, $/1k vs today's LLM cost, and a GO / NO-GO line.
