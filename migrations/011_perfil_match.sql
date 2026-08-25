-- Per-empresa matching profile (cycle 16). Replaces company_profile.md as the
-- company side of the match. Arrays hold normalized terms (see web/lib/normalize.ts):
-- lowercase, accents stripped, single-spaced — identical to enriquecimento.*.
CREATE TABLE IF NOT EXISTS empresa_perfil (
    empresa_id BIGINT PRIMARY KEY REFERENCES empresa(id) ON DELETE CASCADE,
    produtos TEXT[] NOT NULL DEFAULT '{}',        -- what the company sells/executes (raw, as typed)
    palavras_chave TEXT[] NOT NULL DEFAULT '{}',  -- raw, as typed
    exclusoes TEXT[] NOT NULL DEFAULT '{}',       -- raw, as typed
    termos TEXT[] NOT NULL DEFAULT '{}',          -- normalized(produtos ∪ palavras_chave), what the match engine reads
    exclusoes_termos TEXT[] NOT NULL DEFAULT '{}',-- normalized(exclusoes)
    ufs CHAR(2)[] NOT NULL DEFAULT '{}',          -- empty = todas
    valor_min NUMERIC,
    valor_max NUMERIC,
    observacoes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_empresa_perfil_termos ON empresa_perfil USING gin (termos);
