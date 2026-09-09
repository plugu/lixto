---
id: 137
status: done
model: sonnet
depends_on: []
max_attempts: 2
files:
  - experiments/ml-facets/pull.py
  - experiments/ml-facets/README.md
  - experiments/ml-facets/.gitignore
---
## Goal
`uv run experiments/ml-facets/pull.py` copies the LLM-labelled prod tables into local CSVs under `experiments/ml-facets/data/` and refuses to continue when fewer than 1,000 labelled procurements exist.

## Context
Cycle 26 prototype (PRODUCT.md). Throwaway code; `src/lixto` and `web/` untouched. Use PEP 723 inline metadata (`# /// script` … `dependencies = ["pandas"]`) so `uv run <file>` resolves deps without touching `pyproject.toml`.

**Prod access** (read-only): `ssh plugu-prod01`, then inside the VPS `docker exec $(docker ps -qf name=pg-shared) psql -U shared -d lixto -Atc "<sql>"` (peer auth, no password — never put a password on the command line). Tailscale SSH is in "check mode": if `ssh -o BatchMode=yes plugu-prod01 true` hangs >15 s, run `ssh -vvv … 2>&1 | grep -o 'https://login.tailscale.com/a/[A-Za-z0-9]*'`, print that URL and exit 3 — a human must open it; do not loop. Stream each table with `psql … -c "COPY (<query>) TO STDOUT WITH CSV HEADER"` straight into `data/<name>.csv` (subprocess, stdout → file). Print row counts per file.

Queries (all `WHERE`-scoped to procurements that have `procurement_enrichments.status='done'`):
- `enrichments.csv`: `procurement_id, model, input_kind, confidence, concepts, keywords, complexity, requires_certification, requires_technical_certificate, enriched_at` (arrays come out as `{a,b}` — parse later).
- `categories.csv` (`procurement_id, category`), `cnaes.csv` (`procurement_id, cnae_code, confidence`), `requirements.csv` (`procurement_id, kind`).
- `procurements.csv`: `id, source_id, modality_id, modality_name, description, estimated_value`.
- `items.csv`: `procurement_id, item_number, description, kind, catalog_code, ncm_nbs_code`.
- `doc_texts.csv`: `procurement_id, sequence, chars, left(text, 20000) AS text` where `method='pypdf' AND chars > 500`.
- `embeddings.csv`: `procurement_id, model, embedding::text`.
- `profiles.csv` (no scope filter): `company_id, terms, exclusion_terms, embedding_text, embedding::text` from `company_profiles`.
- `llm_cost.csv`: `kind, started_at, counters::text` from `agent_runs` where `kind LIKE 'enrich%' OR kind LIKE 'analyze%'` and `status='done'` (for $/row later).

**Gate**: after the pull, count distinct `procurement_id` in `enrichments.csv`; print the per-`model` breakdown; if total < 1000 write `experiments/ml-facets/REPORT.md` with a one-paragraph "insufficient data" note and exit 2. Known state (2026-09-08): 3,960 done rows — `lixto-qwen` 3,030 (local), `gpt-5-mini` 563, `gemini-3.5-flash-lite` 366, `gemini-3.7-flash` 1 — so the gate passes but only ~930 rows are cloud-labelled; print a WARNING line when cloud rows < 1000. `procurement_items.catalog_code` is NULL for every row in prod — still export the column. Labels from the old local Ollama model are ~45% hallucinated: any `model` value not starting with `gemini-` or `gpt-` is flagged as `local` in the printed breakdown (later tickets train on them but evaluate on cloud rows only).

`README.md`: how to run, the Tailscale URL gotcha, file inventory, what each later script does. `.gitignore`: `data/`, `models/`, `*.parquet`, `__pycache__/`.

## Checks (run in order — cheapest first)
1. `uv run ruff check experiments/ml-facets`
2. `uv run experiments/ml-facets/pull.py --dry-run` (prints the SQL for every file, touches nothing, exit 0)
3. `uv run experiments/ml-facets/pull.py && ls -la experiments/ml-facets/data/*.csv` (needs the VPS reachable; if blocked on the Tailscale URL, report exit 3 honestly)

## Done when
- `data/` holds the nine CSVs with printed row counts, and the console shows the enrichment count per model with `local`/cloud flags; or the script stops with exit 2 (too few rows) / exit 3 (needs Tailscale auth) and says so.

## Not included
- Any modelling (138/139).
- Writing to prod, socat bridges, dumping tables not listed.
