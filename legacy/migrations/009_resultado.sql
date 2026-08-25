CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS resultado (
    numero_controle_pncp TEXT NOT NULL,
    numero_item INTEGER NOT NULL,
    sequencial_resultado INTEGER NOT NULL,
    ni_fornecedor TEXT,
    nome_razao_social_fornecedor TEXT,
    tipo_pessoa TEXT,
    porte_fornecedor_id INTEGER,
    porte_fornecedor_nome TEXT,
    quantidade_homologada NUMERIC,
    valor_unitario_homologado NUMERIC,
    valor_total_homologado NUMERIC,
    percentual_desconto NUMERIC,
    ordem_classificacao_srp INTEGER,
    situacao_compra_item_resultado_id INTEGER,
    situacao_compra_item_resultado_nome TEXT,
    indicador_subcontratacao BOOLEAN,
    data_resultado DATE,
    data_cancelamento TIMESTAMPTZ,
    motivo_cancelamento TEXT,
    data_inclusao TIMESTAMPTZ,
    data_atualizacao TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (numero_controle_pncp, numero_item, sequencial_resultado)
);
CREATE INDEX IF NOT EXISTS idx_resultado_ni_fornecedor ON resultado (ni_fornecedor);
CREATE INDEX IF NOT EXISTS idx_resultado_lookup
  ON resultado (numero_controle_pncp, numero_item);

ALTER TABLE item ADD COLUMN IF NOT EXISTS resultados_sincronizados_em TIMESTAMPTZ;
ALTER TABLE item ADD COLUMN IF NOT EXISTS resultados_solicitados_em TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_item_resultados_fila
  ON item (resultados_solicitados_em)
  WHERE resultados_solicitados_em IS NOT NULL AND resultados_sincronizados_em IS NULL;
