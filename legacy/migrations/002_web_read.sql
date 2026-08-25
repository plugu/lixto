-- 002_web_read.sql
-- Read-side additions for the web dashboard: derived `portal` column and
-- full-text search index over item descriptions. No changes to ingestion.
--
-- Each DDL statement below is committed on its own (instead of letting the
-- whole file run as one implicit transaction) so it only ever locks one of
-- licitacao/item at a time. The ingestion backfill continuously inserts into
-- item then touches licitacao (FK check) inside its own short transactions;
-- a single transaction holding an exclusive lock on licitacao while also
-- needing a lock on item (or vice-versa) reliably deadlocks against that
-- opposite lock order. Splitting removes the AB-BA cycle entirely.

ALTER TABLE licitacao
    ADD COLUMN IF NOT EXISTS portal TEXT
    GENERATED ALWAYS AS (substring(link_sistema_origem from '^https?://([^/]+)')) STORED;
COMMIT;

CREATE INDEX IF NOT EXISTS idx_licitacao_portal ON licitacao (portal);
COMMIT;

CREATE INDEX IF NOT EXISTS idx_item_descricao_fts
    ON item USING GIN (to_tsvector('portuguese', coalesce(descricao, '')));
