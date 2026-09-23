-- Cycle 30 (ticket 168): case agent V1.
--
-- One case per GO recommendation, anchored on the existing `opportunities`
-- row (cycle-18 tables are untouched per ADR 001). `case_checks` holds the
-- habilitação verdict: one line per dossier requirement × document kind,
-- recomputed from scratch on every batch pass (delete + insert), so the
-- verdict always reflects today's `company_documents`.

CREATE TABLE cases (
    id                   BIGSERIAL PRIMARY KEY,
    company_id           BIGINT NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
    procurement_id       BIGINT NOT NULL REFERENCES procurements (id) ON DELETE CASCADE,
    opportunity_id       BIGINT NOT NULL UNIQUE REFERENCES opportunities (id) ON DELETE CASCADE,
    recommendation_id    BIGINT REFERENCES recommendations (id) ON DELETE SET NULL,
    status               TEXT NOT NULL DEFAULT 'waiting_analysis' CHECK (status IN ('waiting_analysis','ready','decided')),
    analysis_version     INTEGER,
    session_at           TIMESTAMPTZ,
    session_source       TEXT CHECK (session_source IN ('dossier_session','dossier_proposal_deadline','procurement_closes_at')),
    email_enqueued_at    TIMESTAMPTZ,
    decision             TEXT CHECK (decision IN ('submit','skip','missing_document')),
    decision_note        TEXT,
    decided_by           BIGINT REFERENCES users (id) ON DELETE SET NULL,
    decided_at           TIMESTAMPTZ,
    results_requested_at TIMESTAMPTZ,
    outcome              TEXT CHECK (outcome IN ('won','lost','disqualified')),
    outcome_source       TEXT CHECK (outcome_source IN ('pncp','operator')),
    outcome_at           TIMESTAMPTZ,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_cases_company_status ON cases (company_id, status, session_at);
CREATE INDEX idx_cases_outcome_sweep ON cases (session_at) WHERE decision = 'submit' AND outcome IS NULL;

CREATE TABLE case_checks (
    id                    BIGSERIAL PRIMARY KEY,
    case_id               BIGINT NOT NULL REFERENCES cases (id) ON DELETE CASCADE,
    requirement_sequence  INTEGER NOT NULL,
    category              TEXT NOT NULL,
    title                 TEXT NOT NULL,
    mandatory             BOOLEAN NOT NULL,
    severity              TEXT NOT NULL,
    citations             JSONB NOT NULL DEFAULT '[]',
    document_kind         TEXT,                         -- NULL iff status = 'manual'
    status                TEXT NOT NULL CHECK (status IN ('met','expiring','missing','manual')),
    document_id           BIGINT REFERENCES company_documents (id) ON DELETE SET NULL,
    document_file_name    TEXT,
    document_valid_until  DATE
);
CREATE UNIQUE INDEX idx_case_checks_unique ON case_checks (case_id, requirement_sequence, COALESCE(document_kind, ''));

-- Widen the outbox for the case email (ticket 170), same move as 007.
ALTER TABLE email_messages DROP CONSTRAINT IF EXISTS email_messages_template_check;
ALTER TABLE email_messages ADD CONSTRAINT email_messages_template_check
    CHECK (template IN ('welcome', 'invite', 'password_reset', 'daily_digest',
                        'signup_received', 'signup_pending_admin', 'signup_approved', 'signup_rejected',
                        'case_ready'));
