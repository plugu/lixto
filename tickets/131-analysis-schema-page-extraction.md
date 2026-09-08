---
id: 131
status: done
model: sonnet
depends_on: []
max_attempts: 3
files:
  - migrations/006_tender_analysis.sql
  - src/lixto/enrich/documents.py
  - tests/test_enrich_documents.py
---
## Goal
Migration 005 creates the tender-analysis tables, and document extraction covers every active PDF of a procurement with per-page text persisted in `procurement_document_pages`.

## Context
Cycle 25 (PRODUCT.md). Cycle-18 tables are never altered (ADR 001): everything new goes in `migrations/006_tender_analysis.sql`, applied by `lixto db init` in filename order. Header comment: `-- Cycle 25 (ticket 131): AI Tender Analysis — dossier tables, on-demand jobs, per-page document text.`

### Migration (exact DDL)
```sql
CREATE TABLE procurement_document_pages (   -- per-page text, one row per PDF page
    procurement_id  BIGINT NOT NULL,
    sequence        INTEGER NOT NULL,
    page            INTEGER NOT NULL,                    -- 1-based
    text            TEXT NOT NULL,
    PRIMARY KEY (procurement_id, sequence, page),
    FOREIGN KEY (procurement_id, sequence) REFERENCES procurement_documents (procurement_id, sequence) ON DELETE CASCADE
);

CREATE TABLE tender_analyses (              -- one deep dossier per procurement (company-agnostic)
    procurement_id     BIGINT PRIMARY KEY REFERENCES procurements (id) ON DELETE CASCADE,
    version            INTEGER NOT NULL DEFAULT 1,
    status             TEXT NOT NULL CHECK (status IN ('done','error')),
    error              TEXT,
    model              TEXT,
    schema_version     TEXT NOT NULL,
    document_set_hash  TEXT,                             -- md5 over active documents, see analysis-queries.ts / analyze/worker.py
    input_kind         TEXT NOT NULL CHECK (input_kind IN ('structured','text','pdf')),
    input_chars        INTEGER NOT NULL DEFAULT 0,
    input_truncated    BOOLEAN NOT NULL DEFAULT false,
    executive_summary  TEXT,
    object_text        TEXT,
    overall_risk       TEXT CHECK (overall_risk IN ('low','medium','high','critical')),
    data               JSONB NOT NULL,                   -- full validated payload (schema 2.0)
    analyzed_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_tender_analyses_status ON tender_analyses (status);
CREATE INDEX idx_tender_analyses_analyzed_at ON tender_analyses (analyzed_at);

CREATE TABLE tender_analysis_facts (        -- basic + commercial fields, each cited
    id              BIGSERIAL PRIMARY KEY,
    procurement_id  BIGINT NOT NULL REFERENCES tender_analyses (procurement_id) ON DELETE CASCADE,
    "group"         TEXT NOT NULL CHECK ("group" IN ('basic','commercial')),
    key             TEXT NOT NULL,
    label           TEXT NOT NULL,
    value           TEXT NOT NULL,
    statement_kind  TEXT NOT NULL CHECK (statement_kind IN ('fact','inference')),
    confidence      TEXT NOT NULL CHECK (confidence IN ('high','medium','low')),
    citations       JSONB NOT NULL DEFAULT '[]',         -- [{"sequence": int, "page": int}]
    UNIQUE (procurement_id, key)
);

CREATE TABLE tender_analysis_dates (
    id              BIGSERIAL PRIMARY KEY,
    procurement_id  BIGINT NOT NULL REFERENCES tender_analyses (procurement_id) ON DELETE CASCADE,
    sequence        INTEGER NOT NULL,
    kind            TEXT NOT NULL CHECK (kind IN ('proposal_deadline','session','clarification_deadline','challenge_deadline','site_visit','contract_start','delivery','other')),
    label           TEXT NOT NULL,
    occurs_at       TIMESTAMPTZ,                         -- null when the text gives no parsable instant
    raw_text        TEXT NOT NULL,
    confidence      TEXT NOT NULL CHECK (confidence IN ('high','medium','low')),
    citations       JSONB NOT NULL DEFAULT '[]',
    UNIQUE (procurement_id, sequence)
);

CREATE TABLE tender_analysis_requirements (
    id              BIGSERIAL PRIMARY KEY,
    procurement_id  BIGINT NOT NULL REFERENCES tender_analyses (procurement_id) ON DELETE CASCADE,
    sequence        INTEGER NOT NULL,
    category        TEXT NOT NULL CHECK (category IN ('participation','legal','fiscal_labor','economic_financial','technical','specification','guarantee','other')),
    title           TEXT NOT NULL,
    description     TEXT NOT NULL,
    mandatory       BOOLEAN NOT NULL,
    severity        TEXT NOT NULL CHECK (severity IN ('low','medium','high','critical')),
    statement_kind  TEXT NOT NULL CHECK (statement_kind IN ('fact','inference')),
    confidence      TEXT NOT NULL CHECK (confidence IN ('high','medium','low')),
    citations       JSONB NOT NULL DEFAULT '[]',
    UNIQUE (procurement_id, sequence)
);
CREATE INDEX idx_tender_analysis_requirements_category ON tender_analysis_requirements (procurement_id, category);

CREATE TABLE tender_analysis_penalties (
    id              BIGSERIAL PRIMARY KEY,
    procurement_id  BIGINT NOT NULL REFERENCES tender_analyses (procurement_id) ON DELETE CASCADE,
    sequence        INTEGER NOT NULL,
    description     TEXT NOT NULL,
    basis           TEXT,                                -- e.g. "0,5% por dia, limitado a 10%"
    confidence      TEXT NOT NULL CHECK (confidence IN ('high','medium','low')),
    citations       JSONB NOT NULL DEFAULT '[]',
    UNIQUE (procurement_id, sequence)
);

CREATE TABLE tender_analysis_risks (        -- risks, red flags, contradictions, amendments
    id              BIGSERIAL PRIMARY KEY,
    procurement_id  BIGINT NOT NULL REFERENCES tender_analyses (procurement_id) ON DELETE CASCADE,
    sequence        INTEGER NOT NULL,
    kind            TEXT NOT NULL CHECK (kind IN ('risk','red_flag','contradiction','amendment')),
    severity        TEXT NOT NULL CHECK (severity IN ('low','medium','high','critical')),
    title           TEXT NOT NULL,
    description     TEXT NOT NULL,
    recommendation  TEXT,
    citations       JSONB NOT NULL DEFAULT '[]',
    UNIQUE (procurement_id, sequence)
);

CREATE TABLE tender_analysis_missing (
    id              BIGSERIAL PRIMARY KEY,
    procurement_id  BIGINT NOT NULL REFERENCES tender_analyses (procurement_id) ON DELETE CASCADE,
    sequence        INTEGER NOT NULL,
    field           TEXT NOT NULL,
    note            TEXT,
    UNIQUE (procurement_id, sequence)
);

CREATE TABLE analysis_jobs (                -- on-demand "Analisar com IA" queue
    id                    BIGSERIAL PRIMARY KEY,
    procurement_id        BIGINT NOT NULL REFERENCES procurements (id) ON DELETE CASCADE,
    company_id            BIGINT NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
    requested_by_user_id  BIGINT REFERENCES users (id) ON DELETE SET NULL,
    status                TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','error')),
    error                 TEXT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at            TIMESTAMPTZ,
    finished_at           TIMESTAMPTZ
);
CREATE INDEX idx_analysis_jobs_queue ON analysis_jobs (created_at) WHERE status IN ('queued','running');
CREATE INDEX idx_analysis_jobs_company_day ON analysis_jobs (company_id, created_at);
CREATE INDEX idx_analysis_jobs_procurement ON analysis_jobs (procurement_id, created_at DESC);
```
Check the `companies.id` / `users.id` types in `migrations/001_core.sql` and match them exactly.

### `src/lixto/enrich/documents.py`
Current behaviour: `extract_for_procurement` handles at most `MAX_DOCS = 2` documents, joins pages into one string stored in `procurement_document_texts.text`, byte cap `MAX_TOTAL_BYTES = 30 MB`. Change:
- Remove `MAX_DOCS`; process **every** row `pick_documents` returns. Add `published_at` to `_SELECT_DOCS_SQL` (keep the existing ORDER BY).
- Byte cap comes from env `LIXTO_ANALYZE_MAX_BYTES` (bytes; default `60 * 1024 * 1024`), read by a `max_total_bytes()` function called inside `extract_for_procurement` (module stays importable without env). Keep the existing "stop when exceeded" semantics; documents skipped by the cap get **no row** (they are simply absent from the result).
- `extract_text(pdf_bytes) -> tuple[list[str], int]` returns the per-page texts (one string per page, `page.extract_text() or ""`) and the page count; `ocr_pdf` likewise returns `(list[str], pages_rendered)`. Joined text (`"\n\n".join(pages)[:MAX_TEXT_CHARS]`) is what goes to `procurement_document_texts.text`, unchanged. Update `_maybe_ocr` accordingly (it now sets `row["page_texts"]`).
- Persist pages: after `_upsert`, when `method in ('pypdf','ocr')`, `DELETE FROM procurement_document_pages WHERE procurement_id=%s AND sequence=%s` then `executemany` insert `(procurement_id, sequence, page, text)` for every page (1-based; empty pages stored as `''`), same commit. Apply `_strip_nul` to each page.
- Cached rows: load pages with `SELECT page, text FROM procurement_document_pages WHERE procurement_id=%s AND sequence=%s ORDER BY page` (`_existing_pages`). A cached `pypdf`/`ocr` row **without** page rows (extracted before this ticket) is treated like the OCR-retry case: re-download and re-extract so pages get written.
- Every result dict now carries: `sequence, method, pages, chars, text, page_texts (list[str] | None), title, type_id, published_at, url, pdf_bytes`. Existing keys keep their meaning so `src/lixto/enrich/worker.py` (untouched here, deleted in ticket 132) still works.

Tests: extend `tests/test_enrich_documents.py` (mocked psycopg/httpx, same style as today) — per-page insert on fresh extraction, pages loaded from cache, cache-without-pages re-extracts, byte cap from env, `MAX_DOCS` gone (3 docs → 3 rows). Do not touch `tests/test_enrich_worker.py`; it must still pass.

## Checks (run in order — cheapest first)
1. `uv run ruff check src tests && uv run ruff format --check src tests`
2. `uv run pytest -q tests/test_enrich_documents.py tests/test_enrich_worker.py tests/test_db.py`
3. `uv run pytest -q`
4. `grep -c "CREATE TABLE" migrations/006_tender_analysis.sql | grep -q 9 && ! grep -n "MAX_DOCS" src/lixto/enrich/documents.py`

## Done when
- `lixto db init` on the docker-compose dev DB applies `006_tender_analysis.sql` (9 tables) with no error.
- `extract_for_procurement` on a procurement with 3 active PDFs returns 3 dicts with `page_texts`, and `procurement_document_pages` holds one row per page.

## Not included
- Any LLM call, prompt or worker change (ticket 132).
- DOCX/XLSX/HTML extraction.
- Docs / `.env.example` updates (ticket 136).
