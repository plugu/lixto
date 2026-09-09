# ml-facets: ML vs LLM benchmark report (cycle 26)

Throwaway benchmark under `experiments/ml-facets/`; see `PRODUCT.md` for the full story.
Every score below measures agreement with the LLM's own labels (not ground truth) on the
cloud-labelled held-out test split.

## Data

- Cloud-labelled (LLM-truth) procurements: 930
- Local-labelled (old Ollama model, ~45% hallucinated per manual review): 3030
- Cloud-only held-out test split size: 186
- `catalog_code` baseline: impossible — the column is NULL for every row in prod today (PNCP never populated it).

## Results

| target | metric | score | threshold | coverage | ms/row | verdict |
|---|---|---|---|---|---|---|
| cnae | CNAE top-3 agreement | 0.3548 | 0.8 | 0.4207 | 4.306 | NO-GO |
| categories | categories micro-F1 | 0.0306 | 0.8 | 0.5782 | 8.691 | NO-GO |
| requires_certification | flag F1 | 0.7027 | 0.8 | N/A | 3.886 | NO-GO |
| requires_technical_certificate | flag F1 | 0.6790 | 0.8 | N/A | 3.816 | NO-GO |
| complexity | complexity macro-F1 | 0.4607 | 0.8 | N/A | 4.022 | NO-GO |
| keywords | keywords mean Jaccard (best of YAKE/TF-IDF) | 0.0354 | 0.5 | N/A | 22.613 | NO-GO |
| embeddings | procurement->procurement top-10 overlap | 0.4533 | 0.7 | N/A | 4.103 | NO-GO |

## Cost

- LLM (today): US$ 1.6925 / 1,000 procurements (from 473 priced runs, 4002 processed)
- ML (compute only, no API cost):
  - cnae: US$ 0.000060 / 1,000 rows (ms/row = 4.306)
  - categories: US$ 0.000121 / 1,000 rows (ms/row = 8.691)
  - requires_certification: US$ 0.000054 / 1,000 rows (ms/row = 3.886)
  - requires_technical_certificate: US$ 0.000053 / 1,000 rows (ms/row = 3.816)
  - complexity: US$ 0.000056 / 1,000 rows (ms/row = 4.022)
  - keywords: US$ 0.000314 / 1,000 rows (ms/row = 22.613)
  - embeddings: US$ 0.000057 / 1,000 rows (ms/row = 4.103)

## Notes

- `catalog_code` baseline is impossible: `procurement_items.catalog_code` is NULL for every row pulled from prod (PNCP never populated it), so there is no free CATMAT/CATSER label to compare against.
- "Agreement with LLM" is not ground truth — every score in this report measures whether cheap ML reproduces what the LLM already said, not whether the LLM itself was correct. A classifier that perfectly mimics a wrong LLM label would still score 1.0 here.
- `categories` is not a closed label set: the pulled data has ~5,995 distinct raw free-form category strings across ~930 cloud-labelled procurements, i.e. most categories appear once. This makes `categories` structurally ill-posed for a multi-label classifier — no amount of tuning fixes an open vocabulary with this little repetition per label.
- `profiles.csv` (company_profiles) is empty in prod (no company ever ran match), so the profile-to-procurement metric is replaced with 20 synthetic pt-BR product phrases; the resulting "hit-rate" is a term-overlap sanity check in local embedding space only, not a real profile benchmark, and carries no threshold.

### What would make ML viable

- **CNAE / categories / complexity / flags**: the limiting factor is label volume (only 930 cloud-labelled rows total, ~744 in the training split) plus, for `categories` specifically, an open label vocabulary. A canonical, closed category taxonomy (a fixed list instead of free-form LLM output) plus ≥5,000 cloud-labelled rows per target would let a TF-IDF/linear baseline be re-evaluated meaningfully; right now every target is starved of examples per class.
- **Embeddings**: nearest-neighbour label transfer (encode locally, then borrow the LLM label of the nearest already-labelled procurement in embedding space) could substitute for a supervised classifier once the local model's neighbourhoods are validated — but that requires the local model to already reproduce useful structure, which this report also measures.
- None of this is a same-cycle fix: it needs either more enrichment volume or a data-model change (canonical taxonomy), both out of scope for cycle 26.

## Reproduce

```
uv run experiments/ml-facets/pull.py             # 137
uv run experiments/ml-facets/pull_summaries.py   # 139, summary column for the embed bench
uv run experiments/ml-facets/bench.py            # 138 + 139, runs all three benches
```

Assumed VPS compute rate for the ML cost estimate: US$ 0.05/CPU-hour.

