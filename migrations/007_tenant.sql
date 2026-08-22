-- 007_tenant.sql
-- Multi-tenant empresa/usuário schema (cycle 7). Two-level model: empresa
-- (the bidder company) has many usuário (login accounts, role admin|member)
-- and many documento_empresa (habilitação documents). sessao backs cookie
-- auth. Tenant scoping (empresa_id) is enforced in query code, not here.

CREATE TABLE IF NOT EXISTS empresa (
    id BIGSERIAL PRIMARY KEY,
    cnpj CHAR(14) NOT NULL UNIQUE,                -- digits only
    razao_social TEXT NOT NULL,
    nome_fantasia TEXT,
    natureza_juridica TEXT,                        -- e.g. '206-2 - Sociedade Empresária Limitada'
    porte TEXT CHECK (porte IN ('MEI','ME','EPP','MEDIO','GRANDE')),
    optante_simples BOOLEAN NOT NULL DEFAULT false,
    inscricao_estadual TEXT,
    inscricao_municipal TEXT,
    cep CHAR(8), logradouro TEXT, numero TEXT, complemento TEXT,
    bairro TEXT, municipio TEXT, uf CHAR(2),
    telefone TEXT, email TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS empresa_cnae (
    id BIGSERIAL PRIMARY KEY,
    empresa_id BIGINT NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
    codigo CHAR(7) NOT NULL,                       -- digits only, e.g. 6201501
    descricao TEXT NOT NULL,
    principal BOOLEAN NOT NULL DEFAULT false,
    UNIQUE (empresa_id, codigo)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_empresa_cnae_principal ON empresa_cnae (empresa_id) WHERE principal;
CREATE TABLE IF NOT EXISTS usuario (
    id BIGSERIAL PRIMARY KEY,
    empresa_id BIGINT NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
    email TEXT NOT NULL UNIQUE,                    -- store lowercased
    senha_hash TEXT,                               -- NULL while invite pending
    nome TEXT NOT NULL,
    cpf CHAR(11),
    telefone TEXT,
    cargo TEXT,
    role TEXT NOT NULL CHECK (role IN ('admin','member')),
    convite_token_hash TEXT,                       -- sha256 hex of invite token
    convite_expira_em TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_usuario_empresa ON usuario (empresa_id);
CREATE TABLE IF NOT EXISTS sessao (
    token_hash TEXT PRIMARY KEY,                   -- sha256 hex of cookie token
    usuario_id BIGINT NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
    expira_em TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sessao_usuario ON sessao (usuario_id);
CREATE TABLE IF NOT EXISTS documento_empresa (
    id BIGSERIAL PRIMARY KEY,
    empresa_id BIGINT NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
    tipo TEXT NOT NULL CHECK (tipo IN ('contrato_social','cartao_cnpj','certidao_federal','certidao_fgts','certidao_trabalhista','certidao_estadual','certidao_municipal','balanco_patrimonial','atestado_capacidade_tecnica','outros')),
    nome_arquivo TEXT NOT NULL,                    -- original filename
    caminho TEXT NOT NULL,                         -- relative path under UPLOADS_DIR
    mime TEXT NOT NULL,
    tamanho_bytes BIGINT NOT NULL,
    validade DATE,
    enviado_por BIGINT REFERENCES usuario(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_documento_empresa ON documento_empresa (empresa_id);
