-- Cycle 25 (ticket 131): AI Tender Analysis — dossier tables, on-demand jobs, per-page document text.

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
