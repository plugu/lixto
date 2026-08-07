-- Portal filtering uses usuario_nome (the publishing system's name, e.g.
-- "Compras.gov.br"): always present, 257 distinct values — unlike
-- link_sistema_origem, which is NULL on ~59% of rows and hides Comprasnet
-- behind SERPRO's app domain. Index already built CONCURRENTLY on the live
-- DB; IF NOT EXISTS makes this a no-op there and real on fresh databases.
CREATE INDEX IF NOT EXISTS idx_licitacao_usuario_nome ON licitacao (usuario_nome);
