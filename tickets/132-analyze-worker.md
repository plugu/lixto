---
id: 132
status: doing
model: opus
depends_on: [131]
max_attempts: 3
files:
  - src/lixto/analyze/__init__.py
  - src/lixto/analyze/schema.py
  - src/lixto/analyze/prompt.py
  - src/lixto/analyze/worker.py
  - src/lixto/cli/analyze.py
  - src/lixto/cli/enrich.py
  - src/lixto/status.py
  - src/lixto/enrich/worker.py
  - tests/test_enrich_worker.py
  - tests/test_analyze_schema.py
  - tests/test_analyze_prompt.py
  - tests/test_analyze_worker.py
  - tests/test_status.py
---
## Goal
`lixto analyze run` replaces `lixto enrich run`: one doc-tier LLM pass per open procurement over the page-tagged text of all its PDFs writes the existing enrichment facets **and** the cited dossier (`tender_analyses` + children) in one transaction.

## Context
Cycle 25 (PRODUCT.md). Ticket 131 created the tables (`migrations/006_tender_analysis.sql`, read it) and made `extract_for_procurement` return every active PDF with `page_texts`, `title`, `type_id`, `published_at`, `url`. Today's worker `src/lixto/enrich/worker.py` (cheap tier, ≤60k chars, schema 1.0) is **deleted** together with `tests/test_enrich_worker.py`; port what is reused (`derive_me_epp`, `fetch_benefit_ids`, `fetch_items`, `_format_item`, `_apply_usage`, `_embed_payload`, the facet SQL + `_persist` facet half, the cap/fence/limit loop, `_collect_pdfs`) into `src/lixto/analyze/worker.py` and port their tests. `src/lixto/status.py` imports `LIXTO_ENRICH_DAILY_CAP` from the old worker → import it from `lixto.analyze.worker` (name unchanged; env var stays `LIXTO_ENRICH_DAILY_CAP`, zero ops churn). `src/lixto/cli/enrich.py` keeps only `embed`. `lixto.enrich.schema` (facet contract, `normalize_term`, `validate_payload`) and `lixto.enrich.embed` stay as they are.

### `src/lixto/analyze/schema.py`
`SCHEMA_VERSION = "2.0"`. `ANALYSIS_SCHEMA` = JSON schema (`additionalProperties: false` everywhere, all enums explicit) with the facet keys of `ENRICHMENT_SCHEMA` (`summary, categories, concepts, keywords, cnae_candidates, requires_certification, requires_technical_certificate, delivery, complexity, confidence` — **not** `requirements`/`risks`, both derived below) plus:
- `executive_summary` (string), `object` (string), `overall_risk` (`low|medium|high|critical`)
- `facts[]`: `{group: basic|commercial, key, label, value, statement_kind: fact|inference, confidence: high|medium|low, citations[]}`. Suggested keys, basic: `procurement_method, dispute_type, judgment_criteria, estimated_value, contract_duration, execution_location, participation_scope`; commercial: `delivery_deadline, delivery_location, payment_terms, payment_deadline, price_adjustment, invoice_requirements`. Keys are `[a-z_]+`, deduped (first wins).
- `dates[]`: `{kind (the CHECK list of tender_analysis_dates), label, occurs_at (ISO-8601 string with offset, or null), raw_text, confidence, citations[]}`
- `requirements[]`: `{category (the CHECK list), title, description, mandatory, severity, statement_kind, confidence, citations[]}`
- `penalties[]`: `{description, basis (string or null), confidence, citations[]}`
- `risks[]`: `{kind: risk|red_flag|contradiction|amendment, severity, title, description, recommendation (string or null), citations[]}`
- `missing[]`: `{field, note (string or null)}`
- `citations[]` items: `{sequence: int, page: int}`.

`validate_analysis(raw, *, doc_pages: dict[int, int]) -> dict | None`: returns `None` on non-dict or when `lixto.enrich.schema.validate_payload(raw)` returns None. Otherwise builds `{**facets, **dossier}` where:
- dossier lists are coerced (drop non-dict entries, strip strings, unknown enum → drop the entry, `mandatory` via `_as_bool` default True, list caps: facts 40, dates 20, requirements 80, penalties 20, risks 40, missing 30);
- citations: keep only `{sequence, page}` ints with `sequence in doc_pages and 1 <= page <= doc_pages[sequence]`, dedupe; a `statement_kind == 'fact'` entry with **zero** valid citations becomes `statement_kind='inference', confidence='low'` (guardrail: a fact must cite);
- `occurs_at`: `datetime.fromisoformat`, naive → assume `-03:00`; unparsable → `None`;
- facet `requirements` derived from dossier requirements: `kind` = `{legal: legal_qualification, fiscal_labor: tax_compliance, technical: technical_qualification, economic_financial: economic_qualification}.get(category, 'other')`, `description = f"{title}: {description}"[:300]`; facet `risks` = `[r.title for r in risks]` (normalized through `_clean_strings`). Both then pass through the existing `_clean_requirements` / `_clean_strings` so the facet contract is unchanged.
- `executive_summary` capped 1500 chars, `object` 1000; `overall_risk` unknown → `None`.

### `src/lixto/analyze/prompt.py`
`INSTRUCTIONS` (Portuguese, English keys/enums like today's) covering: global/company-agnostic; never invent values, numbers, deadlines or prices; every `fact` must carry citations `{sequence, page}` taken from the `[DOC n | título | página p]` tags; what is not in the material goes to `missing`, never guessed; `inference` must say why in `description`; contradictions between documents → `risks.kind='contradiction'` quoting both; newer documents (later publication date, "retificação", "errata", "esclarecimento") override older ones → `risks.kind='amendment'` describing original vs current; never state illegality, say "pode merecer análise jurídica"; restrictive brand/spec, short delivery, disproportionate guarantee, unusual penalties → `red_flag`; the facet rules from the old `INSTRUCTIONS` (categories/concepts/keywords/cnae normalization) verbatim.

`build_prompt(row, items, docs, *, me_epp, max_chars) -> tuple[str, int, bool]` returns `(prompt, input_chars, truncated)`:
1. `## Dados estruturados (PNCP)` — today's lines plus `proposal_opens_at`, `published_at`, `source_id` (add them to `_SELECT_PENDING_SQL`).
2. `## Itens (PNCP)` — `MAX_ITEMS = 60`, today's `_format_item`.
3. `## Documentos` — one line per doc: `[DOC {sequence}] "{title}" (tipo: {type_name}; publicado: {published_at:%Y-%m-%d}; {pages} páginas; texto: {sim|não})`.
4. `## Texto dos documentos` — pages in this order: docs with `type_id == 2` or `edital` in title/type_name first, then the rest by `(published_at asc nulls first, sequence)`. Each page as `[DOC {sequence} | {title[:60]} | página {n}]\n{text}\n`. Stop adding pages when the running char count would exceed `max_chars`; then `truncated=True` and append `[TRUNCADO: {omitted} de {total} páginas omitidas — registre os documentos não lidos em missing]`.
`max_chars` from env `LIXTO_ANALYZE_MAX_CHARS` (default `400_000`), read in the worker.

### `src/lixto/analyze/worker.py`
- `DOCUMENT_SET_HASH_SQL` (ticket 134 copies it verbatim into TS):
```sql
SELECT md5(coalesce(string_agg(
    sequence || ':' || coalesce(to_char(published_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS'), '') || ':' || coalesce(url, ''),
    E'\n' ORDER BY sequence), ''))
FROM procurement_documents
WHERE procurement_id = %(procurement_id)s AND is_active IS TRUE
```
- `_SELECT_PENDING_SQL`: today's, with `NOT EXISTS (SELECT 1 FROM tender_analyses t WHERE t.procurement_id = p.id AND (NOT %(retry_errors)s OR t.status <> 'error'))`; fence splice, `--days`, cap loop identical to today, `_USED_TODAY_SQL` counts `tender_analyses WHERE analyzed_at >= date_trunc('day', now())`.
- `analyze_one(conn, row, *, llm, http_client) -> str` (`'done' | 'error'`): hash → `derive_me_epp` → `extract_for_procurement` → `fetch_items` → `build_prompt`. Routing: any doc with `page_texts` → `input_kind='text'`, `llm.complete_json_text(tier="doc", ...)`; none but ≤2 `insufficient` PDFs → `'pdf'`, `complete_json_pdf`; else `'structured'`, `complete_json_text(tier="cheap", ...)`. `name="tender_analysis"`, `schema=ANALYSIS_SCHEMA`. `doc_pages = {d['sequence']: d['pages'] for d in docs if d.get('page_texts')}`. Invalid payload → error rows (`error='resposta inválida'`).
- `_persist(...)` one transaction: enrichment upsert (today's SQL, `schema_version=SCHEMA_VERSION` 2.0) + categories/requirements/cnaes/embedding facets (today's code) + `tender_analyses` upsert with `ON CONFLICT (procurement_id) DO UPDATE SET version = tender_analyses.version + 1, ...` (`data = json.dumps(payload)`, error rows use `data='{}'`, `status='error'`, dossier fields null) + `DELETE` then insert for facts, dates (sequence = 1-based list index), requirements, penalties, risks, missing (`citations = json.dumps([...])`). Commit once. Per-row failure handling as today (rollback, persist error, return `'error'`).
- `analyze(conn, *, limit, days, retry_errors, llm, http_client, counters, fence) -> dict` = today's `enrich()` loop calling `analyze_one`.

### CLI `src/lixto/cli/analyze.py`
`name = "analyze"`, `app.command("run")` with `--limit/--days/--retry-errors`, `runs.run(conn, "analyze")`, output `analyzed: N (done D, error E)` + the usage/cap lines of today's `enrich run`, exit 1 when errors and zero done.

Tests: mocked psycopg / LlmClient / httpx like the old worker tests. Cover: schema validation (fact-without-citation downgrade, bad citation dropped, date parsing, facet derivation, caps), prompt order/truncation/tags, routing per input kind, persist SQL sequence (enrichment + dossier in one commit), version bump on conflict SQL text, pending SQL text, cap loop, CLI output via `typer.testing.CliRunner` in `tests/test_analyze_worker.py`. `tests/test_status.py` still passes with the import moved. `tests/test_cli_discovery.py` untouched.

## Checks (run in order — cheapest first)
1. `uv run ruff check src tests && uv run ruff format --check src tests`
2. `uv run pytest -q tests/test_analyze_schema.py tests/test_analyze_prompt.py tests/test_analyze_worker.py tests/test_status.py tests/test_enrich_schema.py tests/test_enrich_embed.py`
3. `uv run pytest -q`
4. `! test -f src/lixto/enrich/worker.py && uv run lixto analyze run --help | grep -q -- --retry-errors && uv run lixto enrich --help | grep -q embed && ! uv run lixto enrich --help | grep -q " run"`

## Done when
- `LIXTO_DATABASE_URL=<dev> uv run lixto analyze run --limit 1` on the docker-compose DB (after `lixto sync incremental` + `lixto db init`) writes one `procurement_enrichments` row (schema_version `2.0`, facets filled) and one `tender_analyses` row with children whose citations reference real `(sequence, page)` pairs.
- `lixto enrich run` no longer exists; `lixto enrich embed` still works.

## Not included
- On-demand queue / `analysis_jobs` drain (ticket 133).
- Web reads or UI (tickets 134–135); docs and schedule renames (ticket 136).
- Re-analysis when the document set hash changes (the cron pass only fills procurements without a dossier; the hash is stored for ticket 133/134).
