-- 006_analise.sql
-- Agent verdicts (triage + deep-analysis), one row per licitação.
-- Ticket 13 fills fit_score/verdict/reasoning/triage_*; deep_* columns stay
-- NULL until ticket 14's deep-analysis agent lands.

CREATE TABLE IF NOT EXISTS analise (
    numero_controle_pncp TEXT PRIMARY KEY REFERENCES licitacao (numero_controle_pncp),

    fit_score INTEGER,
    verdict TEXT CHECK (verdict IN ('fit', 'no_fit', 'borderline')),
    reasoning TEXT,
    triage_model TEXT,
    triaged_at TIMESTAMPTZ,

    deep_verdict TEXT,
    requirements JSONB,
    risks JSONB,
    prazos JSONB,
    deep_model TEXT,
    deep_analyzed_at TIMESTAMPTZ,
    deep_status TEXT DEFAULT NULL,
    error TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_analise_verdict ON analise (verdict);
