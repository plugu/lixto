-- pgvector semantic layer (cycle 17). Extension is trusted → app owner can create it.
CREATE EXTENSION IF NOT EXISTS vector;
ALTER TABLE enriquecimento ADD COLUMN IF NOT EXISTS embedding vector(1536);
ALTER TABLE enriquecimento ADD COLUMN IF NOT EXISTS embedding_modelo TEXT;
ALTER TABLE enriquecimento ADD COLUMN IF NOT EXISTS embedding_em TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_enriquecimento_embedding
  ON enriquecimento USING hnsw (embedding vector_cosine_ops);
ALTER TABLE empresa_perfil ADD COLUMN IF NOT EXISTS embedding vector(1536);
ALTER TABLE empresa_perfil ADD COLUMN IF NOT EXISTS embedding_texto TEXT;
ALTER TABLE empresa_perfil ADD COLUMN IF NOT EXISTS embedding_modelo TEXT;
