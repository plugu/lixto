-- Sector classification (TI, Saúde, Obras...) derived from objeto/itens text
-- by `plic classify` — PNCP provides no usable taxonomy fields (NCM ~3%,
-- CATMAT ~0.3%, itemCategoria 99.7% "Não se aplica").
ALTER TABLE licitacao ADD COLUMN IF NOT EXISTS setor TEXT;
ALTER TABLE licitacao ADD COLUMN IF NOT EXISTS setor_classificado_em TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_licitacao_setor ON licitacao (setor);
