-- Accent-insensitive full-text search: "lapis" must match "lápis".
-- unaccent() is STABLE, so FTS expression indexes need an IMMUTABLE wrapper.
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE OR REPLACE FUNCTION f_unaccent(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  RETURN unaccent('unaccent', $1);
CREATE INDEX IF NOT EXISTS idx_licitacao_objeto_fts_unaccent
  ON licitacao USING gin (to_tsvector('portuguese', f_unaccent(coalesce(objeto_compra, ''))));
CREATE INDEX IF NOT EXISTS idx_item_descricao_fts_unaccent
  ON item USING gin (to_tsvector('portuguese', f_unaccent(coalesce(descricao, ''))));
