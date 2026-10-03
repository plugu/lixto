---
id: 183
status: done
model: sonnet
depends_on: [182]
max_attempts: 3
files:
  - src/lixto/classify/worker.py
  - src/lixto/classify/schema.py
  - src/lixto/classify/export.py
  - src/lixto/cli/classify.py
  - src/lixto/cli/sync.py
  - src/lixto/internal_api.py
  - src/lixto/status.py
  - tests/test_classify_worker.py
  - tests/test_classify_schema.py
  - tests/test_status.py
---
## Goal
`lixto classify run` gives every pending open tender ≤3 CNAEs, a segment, a nature and keywords, from cosine candidates + one CHEAP LLM choice, with a daily cap and cost counters; `lixto classify export` writes the owner's review sample.

## Context
Tables and taxonomy from ticket 182 (`procurement_classifications`, `cnae_code_embeddings`, `classification_segments`, `lixto.classify.taxonomy`). Reuse, do not copy: `lixto.enrich.embed` for the pending-row shape (`_SELECT_INGESTED_SQL` embed.py:73-100 — `p.status_id = 1`, `(p.proposal_closes_at >= now() OR p.proposal_opens_at > now())`, non-blank description, DISTINCT item descriptions `LIMIT 20`), `lixto.enrich.schema.normalize_terms` (schema.py:132) and `_clean_cnaes` (schema.py:160) for output hygiene, `lixto.analyze.worker._daily_cap`/`_USED_TODAY_SQL` (worker.py:48, 271-273, 289-296, 801-829) for the cap pattern and `_apply_usage` (758-773) for the `llm_*` counter keys. LLM call: `LlmClient.complete_json_text(tier="cheap", instructions=…, prompt=…, schema=…, name="tender_classification") -> (dict | None, model)` (llm.py:271); `usage_summary()` (258). Runs: `runs.run(conn, "classify")` (runs.py:64; `agent_runs.kind` has no CHECK). Cache revalidate after sync is `_revalidate_web_cache()` in `src/lixto/cli/sync.py:40-52` (uses `InternalApi.cache_revalidate`, internal_api.py:154). Status report: `src/lixto/status.py` (`StatusReport` 111-128, `get_status` 131, `_LLM_TODAY_SQL`/`_LLM_LAST_7D_SQL` 57-71 count kinds `('analyze','analyze_jobs')`, `format_status` 220, email block 261-269 as section example; `tests/test_status.py` exists).

### Work
1. `src/lixto/classify/schema.py`: `SCHEMA_VERSION = "1"`; `CLASSIFICATION_SCHEMA` (strict JSON schema, `additionalProperties: false`): `cnaes: [{code: string, confidence: number}]` (0–3), `segment: string`, `segment_confidence: number`, `nature: enum bens|servicos|obras`, `keywords: [string]` (0–10); `INSTRUCTIONS` (pt-BR: you are classifying a Brazilian public tender; choose only from the listed candidates; confidence 0–1; `outros` only when nothing fits; keywords are short product/service nouns in pt-BR, no agency names); `build_prompt(description, items, cnae_candidates, segment_candidates) -> str` (sections "Objeto", "Itens" (≤20, one per line), "CNAEs candidatos" as `code — description`, "Segmentos candidatos" as `code — label — description`); `validate_payload(raw, *, cnae_candidates: set[str], segment_candidates: list[tuple[str, float]]) -> dict | None` returning `{cnaes: [{code, confidence}] ⊂ candidates, segment, segment_confidence, segment_source: 'llm'|'cosine', nature, keywords}`; unknown segment → top cosine candidate with `segment_source='cosine'` and its cosine as confidence; unknown CNAE codes dropped; missing/invalid nature → None (row becomes `status='error'`).
2. `src/lixto/classify/worker.py`:
   - `_SELECT_PENDING_SQL`: joins `procurement_embeddings pe` (`pe.embedding::text AS embedding`), applies the open/upcoming + status predicates, `p.modality_id = ANY(%(modalities)s)`, and `NOT EXISTS (SELECT 1 FROM procurement_classifications c WHERE c.procurement_id = p.id AND c.schema_version = %(schema_version)s AND (c.status = 'done' OR NOT %(retry_errors)s))`; ordered `p.published_at DESC NULLS LAST, p.id DESC`, `LIMIT %(limit)s`; selects description + items array like embed.py.
   - Candidates per row (two queries, the vector passed as text + `::vector`): `SELECT ce.cnae_code, c.description, 1 - (ce.embedding <=> %(v)s::vector) AS similarity FROM cnae_code_embeddings ce JOIN cnae_codes c ON c.code = ce.cnae_code ORDER BY ce.embedding <=> %(v)s::vector LIMIT 15` and the same over `classification_segments WHERE embedding IS NOT NULL … LIMIT 6` (always append `outros` if absent).
   - `classify_one(conn, row, *, llm) -> str` returning `done|error`: prompt → `complete_json_text` → `validate_payload` → single transaction: `DELETE FROM procurement_cnaes WHERE procurement_id = %(id)s AND origin = 'ingest'`; `INSERT INTO procurement_cnaes (procurement_id, cnae_code, confidence, origin) VALUES (…, 'ingest') ON CONFLICT DO NOTHING` (a dossier row for the same code wins); upsert `procurement_classifications` (`ON CONFLICT (procurement_id) DO UPDATE` all columns, `classified_at = now()`), `data` = `{candidates: {cnaes: [...], segments: [...]}, raw: <llm payload>, model}`. On `None` payload or validation failure: upsert with `status='error'`, `error` text, no CNAE writes. Commit per row; on exception rollback, count `error`, continue; stop the run on the first SDK/connection error (same as embed.py).
   - `classify(conn, *, limit=None, retry_errors=False, llm=None, counters=None) -> dict[str, int]`: cap from env `LIXTO_CLASSIFY_DAILY_CAP` (0/unset = unlimited) counted by `SELECT count(*) FROM procurement_classifications WHERE classified_at >= date_trunc('day', now())`; modalities from env `LIXTO_CLASSIFY_MODALITIES` (default `6,8`); `BATCH_LIMIT_DEFAULT = 1000`; counters `processed`, `classified`, `error`, `cap`, `used_today_at_start`, `cap_reached`, plus `llm_calls`, `llm_prompt_tokens`, `llm_completion_tokens`, `llm_est_usd_micros` and returned `est_usd`. Refuse to start (raise `RuntimeError` with a clear message) when `cnae_code_embeddings` is empty or any segment has a NULL embedding.
3. `src/lixto/classify/export.py`: `export_sample(conn, *, limit: int, out: Path) -> int` writing CSV (`source_id, modality_name, description (≤300 chars), items (≤300 chars, '; '), cnaes ('code:conf' joined by ' '), segment, segment_label, nature, keywords, classified_at`) over `procurement_classifications` `status='done' ORDER BY random() LIMIT %(limit)s`; returns rows written.
4. `src/lixto/internal_api.py`: move the best-effort revalidate into `revalidate_web_cache_best_effort(*, echo=typer.echo) -> None` (same exception set, prints the same warning) and make `src/lixto/cli/sync.py` call it; behaviour of `lixto sync incremental` unchanged (its tests in `tests/test_cli_sync_revalidate.py` must still pass — adjust only import/patch targets if they patch the private name).
5. `src/lixto/cli/classify.py`: add `run [--limit N] [--retry-errors]` (`runs.run(conn, "classify")`, echoes counts + usage line like `cli/analyze.py`, ends with `revalidate_web_cache_best_effort()`, exit 1 when `error > 0 and classified == 0`), and `export --limit 100 --out PATH` (default `scrape-out/classify-sample.csv`).
6. `src/lixto/status.py`: count kind `'classify'` in the two LLM SQLs; new fields `classify_daily_cap`, `classified_today`, `classified_today_errors`, `classify_pending` (open/upcoming modality 6/8 tenders with an embedding and no `done` row at the current `SCHEMA_VERSION`), guarded with `to_regclass('procurement_classifications') IS NOT NULL`; `format_status` gets a `classification:` block after `enrichment:`. Update `tests/test_status.py` fixtures accordingly.
7. Tests: `tests/test_classify_schema.py` — prompt contains every candidate code once, validation drops unknown CNAEs, replaces unknown segment with cosine top-1 and marks `segment_source='cosine'`, rejects bad nature, normalises keywords (≤10, lowercase, deduped); schema is strict. `tests/test_classify_worker.py` — mocked conn/LLM in the style of `tests/test_analyze_worker.py:163-220`: done path writes `DELETE … origin = 'ingest'`, inserts CNAEs with `'ingest'`, upserts classification; `None` payload → `status='error'` and no CNAE insert; cap reached → `cap_reached=1`, zero LLM calls; empty `cnae_code_embeddings` → `RuntimeError`; counters include `llm_*`.

## Checks (run in order — cheapest first)
1. `uv run ruff check src tests && uv run ruff format --check src tests`
2. `uv run pytest -q tests/test_classify_schema.py tests/test_classify_worker.py tests/test_status.py tests/test_cli_sync_revalidate.py tests/test_cli_discovery.py`
3. `uv run pytest -q`
4. `uv run lixto classify run --help | grep -q -- --retry-errors && uv run lixto classify export --help | grep -q -- --out`
5. `uv run lixto status | grep -q '^classification:'`

## Done when
- With label embeddings present and an LLM key, `lixto classify run --limit 20` on the dev DB writes 20 `procurement_classifications` rows and `origin='ingest'` CNAE rows, prints a usage line, and calls the cache revalidate (warning only if the web app is down). The owner performs this run; the checks above cover everything that runs without a key.
- `lixto classify export --limit 100` produces the review CSV for the success demo.

## Not included
- Changing analyze worker deletes (184); web (185/186); docs/README/STATE (187); Dokploy schedule edit (manual, listed in 187's STATE.md Next).
- Backfill of closed tenders; CNAE→segment mapping for companies; retries beyond `--retry-errors`.
