---
id: 139
status: done
model: sonnet
depends_on: [138]
max_attempts: 2
files:
  - experiments/ml-facets/bench_embed.py
  - experiments/ml-facets/bench.py
  - experiments/ml-facets/.gitignore
  - experiments/ml-facets/README.md
---
## Goal
`uv run experiments/ml-facets/bench.py` runs every bench and writes `experiments/ml-facets/REPORT.md` with per-target scores, coverage, ms/row, $/1k vs today's LLM cost, and a GO / NO-GO line per target.

## Context
Cycle 26 prototype (PRODUCT.md). PEP 723 inline deps; `uv run <file>`. Inputs: `data/*.csv` (137), `results/classify.json` + `results/keywords.json` (138), `features.py` helpers (138).

**`bench_embed.py`** — deps `sentence-transformers`, `torch`, `numpy`, `pandas`. Model: `intfloat/multilingual-e5-base` (768-d; prefix texts with `passage: ` / queries with `query: `), device `mps` if available else cpu; cache under `experiments/ml-facets/models/`. Texts: rebuild the canonical embedding text exactly as `src/lixto/enrich/embed.py:61-77` (`summary` + concepts/keywords/categories lines) from `enrichments.csv` + `categories.csv` (copy the function; do not import) — this is what the stored vectors were computed from, so the comparison is fair. Restrict to procurements present in `embeddings.csv` (parse `[...]` text into float arrays); subsample 3,000 max, fixed seed.
Metrics: (1) **procurement→procurement top-10 overlap**: for 300 random query rows, top-10 cosine neighbours in stored space vs local space, mean |∩|/10; (2) **profile→procurement top-10 overlap** — `profiles.csv` is EMPTY in prod (no company profiles), so substitute 20 synthetic queries (short pt-BR product phrases, e.g. "notebooks corporativos", "serviço de limpeza predial", "medicamentos hospitalares") embedded locally with `query: ` prefix vs the stored space — but the stored space has no query vectors for them, so report this metric only as local-space top-10 *term hit-rate* (fraction of top-10 whose text contains a query token) and mark it informational, not a threshold; (3) Spearman correlation of the two similarity matrices on the 300-row sample; (4) encode ms/row on the M4 and the model's dimension. Write `results/embed.json`.

**`bench.py`** — orchestrator: runs `bench_classify.py`, `bench_keywords.py`, `bench_embed.py` as subprocesses (skip one with a warning if its inputs are missing), then:
- LLM cost today: from `data/llm_cost.csv` parse `counters` JSON, sum `llm_est_usd_micros` and `processed` across runs → USD per 1k procurements (report the count of runs used; if zero, say "no priced runs" and fall back to `LlmClient.PRICES_USD_PER_M`-style estimate: quote the prompt-token average from counters if present, else N/A).
- ML cost: API $0; compute = ms/row × an assumed US$0.05/CPU-hour VPS rate → $/1k (state the assumption).
- Thresholds (from PRODUCT.md): CNAE top-3 ≥ 0.80; categories micro-F1 ≥ 0.80; each flag F1 ≥ 0.80; complexity macro-F1 ≥ 0.80; keywords mean Jaccard ≥ 0.50 (best of YAKE/TF-IDF); embeddings procurement→procurement top-10 overlap ≥ 0.70.
- `REPORT.md` sections: Data (rows per model, cloud vs local label counts, cloud-only test split size) · Results table (target | metric | score | threshold | coverage | ms/row | verdict GO/NO-GO) · Cost (LLM $/1k today vs ML $/1k) · Notes (catalog_code baseline impossible — column empty in prod; caveat that "agreement with LLM" is not ground truth) · Reproduce (commands). Print the table to stdout too.

Add `results/` and `REPORT.md`? — no: **commit REPORT.md** (it is the deliverable); add `results/` and `models/` to `.gitignore`. Update `README.md` with the full pipeline and how to read the verdicts.

## Checks (run in order — cheapest first)
1. `uv run ruff check experiments/ml-facets`
2. `uv run experiments/ml-facets/bench_embed.py && test -s experiments/ml-facets/results/embed.json`
3. `uv run experiments/ml-facets/bench.py && grep -c "GO" experiments/ml-facets/REPORT.md`

## Done when
- `REPORT.md` exists with one row per target carrying a GO or NO-GO verdict, a cost section, and the data caveats; the whole `bench.py` run finishes on the M4 in < 20 min (model download excluded).

## Not included
- Fine-tuning, second embedding models (bge-m3 optional only if e5 finishes in time — note it as follow-up otherwise).
- Any production wiring, re-embedding, or docs outside `experiments/ml-facets/`.
