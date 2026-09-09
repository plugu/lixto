---
id: 138
status: done
model: sonnet
depends_on: [137]
max_attempts: 2
files:
  - experiments/ml-facets/features.py
  - experiments/ml-facets/bench_classify.py
  - experiments/ml-facets/bench_keywords.py
---
## Goal
Two scripts score cheap ML against the LLM labels pulled by 137: closed-set classifiers (CNAE, categories, two boolean flags, complexity) and unsupervised keyword extraction, each writing a JSON result file that 139 turns into the report.

## Context
Cycle 26 prototype (PRODUCT.md). PEP 723 inline deps (`pandas`, `scikit-learn`, `numpy`, `yake`); `uv run <file>`. Input = `experiments/ml-facets/data/*.csv` from ticket 137 (schemas in `tickets/137-mlbench-pull-data.md`). Output = `experiments/ml-facets/results/classify.json` and `results/keywords.json` (create `results/`; adding it to `.gitignore` is 139's job — just write the files).

**`features.py`** (imported by both): load CSVs; parse Postgres array literals (`{a,"b c"}`) into lists; tag each row `label_source = 'cloud'` when `model` starts with `gemini-`/`gpt-`, else `'local'` (prod has ~930 cloud vs ~3,030 local `lixto-qwen` rows; local CNAE codes are ~45% hallucinated, other local facets are usable but noisier). **Evaluation always happens on cloud-labelled held-out rows only**; training uses all rows except for the CNAE target, which trains on cloud rows only. Record `cloud_rows`, `local_rows`, `test_rows` (cloud); build one text per procurement = `procurements.description` + "\n" + item descriptions joined + "\n" + first 4,000 chars of the longest `doc_texts.text` for that procurement (missing parts skipped); `normalize_term` copied verbatim from `src/lixto/enrich/schema.py:120-129` (do not import the package — keep the experiment standalone); a fixed split helper: 20% of the *cloud* rows (random_state=42) are the test set; everything else (remaining cloud + all local) is train, with a `cloud_only=True` option for CNAE; a `timed(fn)` helper returning ms/row.

**`bench_classify.py`** — TF-IDF (word 1–2-grams + char_wb 3–5-grams, `sublinear_tf`, `min_df=2`) → linear models:
- CNAE: labels = `cnaes.csv` codes per procurement (multi-label). `OneVsRestClassifier(LogisticRegression(C=4, max_iter=2000))`; metric = **top-3 agreement** (any true code in top-3 predicted) plus micro-F1 at threshold 0.5; drop codes with <5 training rows and report the coverage that leaves. Deterministic baseline via `items.catalog_code` is skipped — the column is NULL for every prod row (write `catalog_code_coverage: 0` in the JSON so the report can say so).
- categories: multi-label like CNAE, metric micro-F1 + macro-F1.
- `requires_certification`, `requires_technical_certificate`: binary `LogisticRegression(class_weight="balanced")`, metric F1 on the positive class + precision/recall + positive rate.
- `complexity`: 3-class, metric macro-F1 + accuracy.
Also report `train_rows`, `test_rows`, `cloud_rows`, `local_rows`, and predict ms/row (vectorize + predict, test split). Write everything to `results/classify.json` as `{target: {metric: value, ...}}`.

**`bench_keywords.py`** — reference set per procurement = `normalize_term` of `keywords ∪ concepts` from `enrichments.csv`. Candidates: (a) YAKE `lan="pt", n=3, top=15`; (b) TF-IDF top-15 terms of the same word 1–2-gram vectorizer fitted on all texts. Metrics on the test split: mean Jaccard (after normalizing candidates), recall@15 against the reference set, and a "loose" recall where a reference term counts as hit if it is a substring of any candidate or vice versa. ms/row for each method. Write `results/keywords.json`.

Both scripts print a compact table to stdout and must run end-to-end on the M4 in < 10 min; subsample to 5,000 procurements (fixed seed) if more exist.

## Checks (run in order — cheapest first)
1. `uv run ruff check experiments/ml-facets`
2. `uv run experiments/ml-facets/bench_classify.py && test -s experiments/ml-facets/results/classify.json`
3. `uv run experiments/ml-facets/bench_keywords.py && test -s experiments/ml-facets/results/keywords.json`

## Done when
- Both JSON files exist with every target listed above, numbers are printed, and `cloud_rows`/`local_rows`/`test_rows` are reported.

## Not included
- Embeddings (139), the markdown report, thresholds/GO-NO-GO (139).
- Hyper-parameter search, deep models, model persistence.
