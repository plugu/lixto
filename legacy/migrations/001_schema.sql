-- 001_schema.sql
-- Core schema for licitacao / item / documento mirrors of PNCP, plus sync_state.
-- Column choices follow docs/PNCP_API.md DTO field lists.

CREATE TABLE IF NOT EXISTS licitacao (
    numero_controle_pncp TEXT PRIMARY KEY,

    ano_compra INTEGER,
    sequencial_compra INTEGER,
    numero_compra TEXT,
    processo TEXT,

    -- flattened orgaoEntidade
    orgao_cnpj TEXT,
    orgao_razao_social TEXT,
    poder_id TEXT,
    esfera_id TEXT,

    -- flattened unidadeOrgao
    unidade_codigo TEXT,
    unidade_nome TEXT,
    uf TEXT,
    municipio_nome TEXT,
    codigo_ibge TEXT,

    modalidade_id INTEGER,
    modalidade_nome TEXT,
    modo_disputa_id INTEGER,
    modo_disputa_nome TEXT,
    situacao_compra_id INTEGER,
    situacao_compra_nome TEXT,

    tipo_instrumento_convocatorio_codigo INTEGER,
    tipo_instrumento_convocatorio_nome TEXT,

    -- flattened amparoLegal
    amparo_legal_codigo TEXT,
    amparo_legal_nome TEXT,

    objeto_compra TEXT,
    informacao_complementar TEXT,
    srp BOOLEAN,

    valor_total_estimado NUMERIC,
    valor_total_homologado NUMERIC,

    data_abertura_proposta TIMESTAMPTZ,
    data_encerramento_proposta TIMESTAMPTZ,
    data_publicacao_pncp TIMESTAMPTZ,
    data_inclusao TIMESTAMPTZ,
    data_atualizacao TIMESTAMPTZ,
    data_atualizacao_global TIMESTAMPTZ,

    link_sistema_origem TEXT,
    link_processo_eletronico TEXT,
    fontes_orcamentarias JSONB,
    usuario_nome TEXT,

    raw JSONB NOT NULL,

    itens_sincronizados_em TIMESTAMPTZ,
    arquivos_sincronizados_em TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS item (
    numero_controle_pncp TEXT NOT NULL REFERENCES licitacao (numero_controle_pncp),
    numero_item INTEGER NOT NULL,

    descricao TEXT,
    material_ou_servico TEXT,
    material_ou_servico_nome TEXT,
    quantidade NUMERIC,
    unidade_medida TEXT,
    valor_unitario_estimado NUMERIC,
    valor_total NUMERIC,
    criterio_julgamento_id INTEGER,
    criterio_julgamento_nome TEXT,
    situacao_compra_item_id INTEGER,
    situacao_compra_item_nome TEXT,
    tipo_beneficio_id INTEGER,
    tipo_beneficio_nome TEXT,
    ncm_nbs_codigo TEXT,
    catalogo_codigo_item TEXT,
    data_inclusao TIMESTAMPTZ,
    data_atualizacao TIMESTAMPTZ,

    raw JSONB NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (numero_controle_pncp, numero_item)
);

CREATE TABLE IF NOT EXISTS documento (
    numero_controle_pncp TEXT NOT NULL REFERENCES licitacao (numero_controle_pncp),
    sequencial_documento INTEGER NOT NULL,

    titulo TEXT,
    tipo_documento_id INTEGER,
    tipo_documento_nome TEXT,
    tipo_documento_descricao TEXT,
    url TEXT,
    status_ativo BOOLEAN,
    data_publicacao_pncp TIMESTAMPTZ,
    cnpj TEXT,
    ano_compra INTEGER,
    sequencial_compra INTEGER,

    raw JSONB NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (numero_controle_pncp, sequencial_documento)
);

CREATE TABLE IF NOT EXISTS sync_state (
    key TEXT PRIMARY KEY,
    value JSONB,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_licitacao_uf ON licitacao (uf);
CREATE INDEX IF NOT EXISTS idx_licitacao_modalidade_id ON licitacao (modalidade_id);
CREATE INDEX IF NOT EXISTS idx_licitacao_data_publicacao_pncp ON licitacao (data_publicacao_pncp);
CREATE INDEX IF NOT EXISTS idx_licitacao_data_encerramento_proposta
    ON licitacao (data_encerramento_proposta);
CREATE INDEX IF NOT EXISTS idx_licitacao_orgao_cnpj ON licitacao (orgao_cnpj);
CREATE INDEX IF NOT EXISTS idx_licitacao_objeto_compra_fts
    ON licitacao USING GIN (to_tsvector('portuguese', objeto_compra));

CREATE OR REPLACE VIEW v_abertas AS
SELECT *
FROM licitacao
WHERE data_abertura_proposta <= now()
  AND now() < data_encerramento_proposta;

CREATE OR REPLACE VIEW v_futuras AS
SELECT *
FROM licitacao
WHERE data_abertura_proposta > now();

CREATE OR REPLACE VIEW v_encerradas AS
SELECT *
FROM licitacao
WHERE data_encerramento_proposta < now()
   OR data_encerramento_proposta IS NULL;
