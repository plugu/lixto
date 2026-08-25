-- Global enrichment: one canonical row per licitação, produced once at
-- ingestion (cycle 16) and reused by every empresa. Never per-tenant.
CREATE TABLE IF NOT EXISTS enriquecimento (
    numero_controle_pncp TEXT PRIMARY KEY REFERENCES licitacao (numero_controle_pncp),
    schema_version TEXT NOT NULL,
    modelo TEXT,
    confianca REAL,
    status TEXT NOT NULL CHECK (status IN ('done', 'error')),
    erro TEXT,
    fonte TEXT NOT NULL CHECK (fonte IN ('estruturado', 'texto', 'pdf')),
    resumo TEXT,
    categorias TEXT[] NOT NULL DEFAULT '{}',
    conceitos TEXT[] NOT NULL DEFAULT '{}',
    palavras_chave TEXT[] NOT NULL DEFAULT '{}',
    cnae_candidatos JSONB NOT NULL DEFAULT '[]',
    requisitos JSONB NOT NULL DEFAULT '[]',
    exige_certificacao BOOLEAN,
    exige_atestado_tecnico BOOLEAN,
    me_epp_exclusivo BOOLEAN,
    me_epp_preferencia BOOLEAN,
    entrega JSONB,
    riscos TEXT[] NOT NULL DEFAULT '{}',
    complexidade TEXT CHECK (complexidade IN ('baixa', 'media', 'alta')),
    dados JSONB NOT NULL,
    enriquecido_em TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_enriquecimento_palavras ON enriquecimento USING gin (palavras_chave);
CREATE INDEX IF NOT EXISTS idx_enriquecimento_conceitos ON enriquecimento USING gin (conceitos);
CREATE INDEX IF NOT EXISTS idx_enriquecimento_categorias ON enriquecimento USING gin (categorias);
CREATE INDEX IF NOT EXISTS idx_enriquecimento_status ON enriquecimento (status);

-- Deterministic text extracted from edital PDFs (pypdf), stored once so the
-- worker never re-downloads and any future re-enrichment reuses it.
CREATE TABLE IF NOT EXISTS documento_texto (
    numero_controle_pncp TEXT NOT NULL,
    sequencial_documento INTEGER NOT NULL,
    metodo TEXT NOT NULL CHECK (metodo IN ('pypdf', 'insuficiente', 'nao_pdf', 'falha')),
    paginas INTEGER,
    chars INTEGER NOT NULL DEFAULT 0,
    texto TEXT,
    extraido_em TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (numero_controle_pncp, sequencial_documento),
    FOREIGN KEY (numero_controle_pncp, sequencial_documento)
        REFERENCES documento (numero_controle_pncp, sequencial_documento)
);
