# ml-facets (cycle 26)

Throwaway benchmark: can cheap ML (TF-IDF, YAKE/KeyBERT, a local embedding model) reproduce
what the LLM enrichment pipeline already produces, and what does that save per 1,000
procurements? See `PRODUCT.md` for the full story. `src/lixto` and `web/` are untouched by
anything in this directory.

## Step 1 — pull the data (this ticket, 137)

```
uv run experiments/ml-facets/pull.py --dry-run   # prints the SQL for every file, touches nothing
uv run experiments/ml-facets/pull.py             # pulls all tables into data/*.csv
```

Reads prod read-only over Tailscale SSH (`plugu-prod01` → `pg-shared` Postgres container,
peer auth, no password ever on the command line). No writes to prod, no socat bridge.

### The Tailscale check-mode gotcha

Tailscale SSH sometimes drops into "check mode" and the plain `ssh` call hangs instead of
failing fast. `pull.py` gives the initial connectivity probe 15s; if it doesn't succeed it
re-runs `ssh -vvv` and greps the output for a `https://login.tailscale.com/a/...` URL, prints
it, and exits **3**. A human has to open that URL in a browser to re-authenticate the node —
the script does not (and must not) loop waiting for that; just re-run `pull.py` afterwards.

### Output

`data/` (gitignored) holds the following CSVs, all scoped to procurements that have a `done`
row in `procurement_enrichments` (except `profiles.csv`, which has no procurement scope):

| file | source | notes |
|---|---|---|
| `enrichments.csv` | `procurement_enrichments` | `concepts`/`keywords` are Postgres array literals, e.g. `{a,b}` — not JSON, parse with a simple `{`/`}`/`,` split or `psycopg`'s array parser later |
| `categories.csv` | `procurement_categories` | |
| `cnaes.csv` | `procurement_cnaes` | |
| `requirements.csv` | `procurement_requirements` | |
| `procurements.csv` | `procurements` | id/source_id/modality/description/estimated_value only |
| `items.csv` | `procurement_items` | `catalog_code` is NULL for every row in prod today (PNCP never populated it) — still exported for completeness |
| `doc_texts.csv` | `procurement_document_texts` | `method='pypdf' AND chars>500` only; `text` truncated to 20,000 chars server-side; this is the biggest file (tens of MB) |
| `embeddings.csv` | `procurement_embeddings` | `embedding::text` is pgvector's bracket format, e.g. `[0.01,-0.02,...]` — 1536 floats, not a Postgres array literal |
| `profiles.csv` | `company_profiles` | no procurement scope (company-level); `embedding`/`embedding_text` may be NULL if a company never ran match |
| `llm_cost.csv` | `agent_runs` | `kind LIKE 'enrich%' OR 'analyze%'`, `status='done'`; `counters::text` is JSON (`counters` is `jsonb`), parse with `json.loads` |

### The 1,000-row gate

After pulling, `pull.py` counts distinct `procurement_id` in `enrichments.csv` and prints a
per-`model` breakdown. Any `model` value not starting with `gemini-` or `gpt-` (today: the old
local Ollama model, `lixto-qwen`) is flagged `local` — those labels are ~45% hallucinated per
manual review, so later tickets may train on them but must evaluate on `cloud`-flagged rows
only. If cloud rows are below 1,000 the script still proceeds but prints a `WARNING` line. If
**total** labelled procurements are below 1,000, it writes `REPORT.md` with a one-paragraph
"insufficient data" note and exits **2** — no CSVs are deleted, but treat the pull as unusable
for benchmarking.

## Step 2 — bench_classify.py / bench_keywords.py (138)

TF-IDF + linear classifiers for CNAE/categories/flags/complexity, and YAKE/TF-IDF for
keyword extraction, evaluated on the cloud-labelled held-out split (`features.py`'s
`make_split`). Each writes its own `results/*.json`; see `features.py` for the shared
loaders, `parse_pg_array`, and split logic.

```
uv run experiments/ml-facets/bench_classify.py
uv run experiments/ml-facets/bench_keywords.py
```

## Step 3 — pull_summaries.py + bench_embed.py + bench.py (139)

`pull_summaries.py` is a small add-on to `pull.py`: it fetches `procurement_enrichments.summary`
for `done` rows into `data/summaries.csv`, since `pull.py` (137) didn't export it and the
canonical embedding text needs it.

`bench_embed.py` rebuilds that canonical text with a **verbatim copy** of
`src/lixto/enrich/embed.py`'s `build_embedding_text` (summary + concepts/keywords/categories),
encodes it locally with `intfloat/multilingual-e5-base` (sentence-transformers, device `mps`
if available, cached under `models/`), and compares the local embedding space against the
stored `procurement_embeddings` vectors (1536-d, `gemini-embedding-001`) on a 3,000-row
subsample:

1. **procurement→procurement top-10 overlap** — mean `|∩|/10` between stored-space and
   local-space top-10 cosine neighbours, over 300 random query rows. This is the metric with
   a threshold (≥ 0.70).
2. **profile→profile hit-rate (informational only, no threshold)** — `profiles.csv` is empty
   in prod, so 20 synthetic pt-BR product phrases substitute for real company profiles;
   since the stored space has no query vectors for them, this only reports whether a query's
   local-space top-10 neighbours' text contains one of its tokens.
3. **Spearman correlation** of the two similarity matrices on the same 300-row sample.
4. **encode ms/row** and the model's dimension (768, vs. the stored 1536).

`bench.py` is the orchestrator ticket 139 asked for: it runs `bench_classify.py`,
`bench_keywords.py`, and `bench_embed.py` as subprocesses (skipping one with a warning if its
input CSVs are missing), then writes `REPORT.md` — the deliverable, committed to the repo —
with a results table (target | metric | score | threshold | coverage | ms/row | verdict),
LLM cost today vs. ML compute cost per 1,000 procurements, and the data caveats (open
`categories` vocabulary, empty `catalog_code`, "agreement with LLM" ≠ ground truth).

```
uv run experiments/ml-facets/pull_summaries.py
uv run experiments/ml-facets/bench.py
```

### How to read the verdicts

Every score in `REPORT.md` is **agreement with the LLM's own output**, not ground truth — a
classifier that perfectly reproduces a wrong LLM label still scores 1.0. `GO` means the score
cleared the PRODUCT.md threshold for that target (CNAE top-3 ≥ 0.80, categories/flags F1 ≥
0.80, complexity macro-F1 ≥ 0.80, keywords Jaccard ≥ 0.50, embeddings top-10 overlap ≥ 0.70);
`NO-GO` means it didn't. `SKIP` means a target had no data to score (e.g. too few training
rows for a class). As of this cycle, every target is `NO-GO` — see `REPORT.md`'s Notes section
for why (mainly label volume: 930 cloud-labelled rows total) and what would change the picture.
