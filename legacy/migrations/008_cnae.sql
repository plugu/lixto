-- CNAE reference table (IBGE subclasses) + licitação↔CNAE tagging, used by
-- `plic cnae seed` and the classification routine (ticket 51).
CREATE TABLE IF NOT EXISTS cnae (
    codigo CHAR(7) PRIMARY KEY,
    descricao TEXT NOT NULL,
    divisao CHAR(2) NOT NULL,
    divisao_descricao TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS licitacao_cnae (
    numero_controle_pncp TEXT NOT NULL,
    codigo CHAR(7) NOT NULL REFERENCES cnae,
    confidence REAL,
    PRIMARY KEY (numero_controle_pncp, codigo)
);
CREATE INDEX IF NOT EXISTS idx_licitacao_cnae_codigo ON licitacao_cnae (codigo);

ALTER TABLE licitacao ADD COLUMN IF NOT EXISTS cnae_classificado_em TIMESTAMPTZ;
