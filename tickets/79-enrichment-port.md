---
id: 79
status: todo
model: opus
depends_on: [74]
max_attempts: 4
files:
  - src/lixto/llm.py
  - src/lixto/enrich/__init__.py
  - src/lixto/enrich/schema.py
  - src/lixto/enrich/documents.py
  - src/lixto/enrich/worker.py
  - src/lixto/enrich/embed.py
  - src/lixto/cnae_seed.py
  - src/lixto/cli/enrich.py
  - src/lixto/cli/cnae.py
  - tests/lixto/test_llm.py
  - tests/lixto/test_enrich_schema.py
  - tests/lixto/test_enrich_documents.py
  - tests/lixto/test_enrich_worker.py
  - tests/lixto/test_enrich_embed.py
  - tests/lixto/test_cnae_seed.py
---
## Goal
Global enrichment runs against the new schema: `lixto enrich run` writes `procurement_enrichments` + the facet tables (`procurement_categories`, `procurement_requirements`, `procurement_cnaes`, `procurement_embeddings`) and `procurement_document_texts`; `lixto enrich embed` backfills vectors; `lixto cnae seed` fills `cnae_codes`.

## Context

Read `PRODUCT.md`, `docs/adr/001-lixto-data-model.md` (D3 enrichment tables — note requirement `kind` values and `complexity` are now English enums; `input_kind` replaces `fonte`; keywords/concepts/risks arrays stay on the enrichment row; categories/requirements/cnaes/embeddings are separate tables). **Port** `src/plic/llm.py`, `src/plic/enrich/{schema,documents,worker,embed}.py`, `src/plic/cnae_seed.py` and their tests under `tests/` to the new names; behaviour is already proven — keep it (tier routing text/pdf/structured, per-row commit, embed failure never blocks, `_FirstPageOnly` not relevant here). Env prefix becomes `LIXTO_LLM_*` (`BASE_URL`, `API_KEY` with `OPENAI_API_KEY` fallback, `MODEL_CHEAP`, `MODEL_DOC`, `MODEL_STRONG`, `MODEL_FALLBACK`, `MODEL_EMBED`). Wrap runs in `lixto.runs.run`. Do not import anything from `plic`.

### Changes vs the port
- LLM output schema (`ENRICHMENT_SCHEMA`) uses English keys matching the columns: `summary, categories, concepts, keywords, cnae_candidates[{code, confidence}], requirements[{kind, description}], requires_certification, requires_technical_certificate, me_epp_exclusive, me_epp_preference, delivery{location, deadline_days}, risks, complexity (low|medium|high), confidence`. Prompt stays Portuguese (the source text is Portuguese); instruct the model to emit the English enum values.
- Persist in one transaction per procurement: upsert `procurement_enrichments` (`data` = full payload), replace `procurement_categories`, `procurement_requirements` (sequence = position), `procurement_cnaes` (7-digit codes, `origin='enrichment'`), upsert `procurement_embeddings` when the embedding succeeded.
- Pending selection: procurements with `proposal_closes_at >= now() OR proposal_opens_at > now()`, no enrichment row, optional `--days` on `published_at`, `--retry-errors`; no portal allowlist.
- `documents.py` reads `procurement_documents` (edital first: `type_id = 2` or title/type ILIKE '%edital%'), writes `procurement_document_texts` (`method` values `pypdf|insufficient|not_pdf|failed`).
- `embed.py`: `build_embedding_text` = summary + concepts + keywords + categories; `embed_pending` selects enrichments with `status='done'` lacking an embeddings row.
- `cnae_seed.py`: IBGE subclasses → `cnae_codes` (port of `plic.cnae_seed`).
- CLI: `cli/enrich.py` (`name="enrich"`: `run [--limit] [--days] [--retry-errors]`, `embed [--limit]`), `cli/cnae.py` (`name="cnae"`: `seed`).

## Checks (run in order — cheapest first)
1. `uv run ruff check src/lixto tests/lixto`
2. `uv run ruff format --check src/lixto tests/lixto`
3. `uv run pytest -q tests/lixto`
4. `uv run lixto enrich run --help | grep -q -- --retry-errors && uv run lixto cnae seed --help >/dev/null`
5. Live: `uv run lixto cnae seed` → `select count(*) from cnae_codes` > 1000. If `LIXTO_LLM_API_KEY`/`OPENAI_API_KEY` is set and procurements exist locally: `uv run lixto enrich run --limit 2` exits 0 and `select count(*) from procurement_enrichments where status='done'` ≥ 1, `select count(*) from procurement_categories` ≥ 1. Otherwise skip and say so.

## Done when
- One `lixto enrich run` fills the enrichment row plus all four facet tables for each processed procurement; `lixto enrich embed` is a no-op afterwards.

## Not included
- Web reads (82), prompt quality tuning, Ollama anything, `plic` deletion (85).
