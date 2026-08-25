---
id: 71
status: done
model: opus
depends_on: []
max_attempts: 3
files:
  - migrations/013_embedding.sql
  - docker-compose.yml
  - src/plic/llm.py
  - src/plic/enrich/embed.py
  - src/plic/enrich/worker.py
  - src/plic/cli.py
  - tests/test_llm.py
  - tests/test_enrich_embed.py
  - tests/test_enrich_worker.py
---
## Goal
Every enriched licitação gets a pgvector embedding, produced by the enrichment worker (and by a backfill command for existing rows), through the provider-abstracted `LlmClient`.

## Context

Read `PRODUCT.md`. Production Postgres is now `pgvector/pgvector:pg18-trixie` (pgvector 0.8.6). `vector` is a **trusted** extension, so `CREATE EXTENSION IF NOT EXISTS vector` works for the app DB owner exactly like `unaccent` in `migrations/005_unaccent_fts.sql` — no superuser step. Existing code to extend, not rewrite: `src/plic/llm.py` (`LlmClient`, env `PLIC_LLM_*`), `src/plic/enrich/worker.py` (`enrich_one`, upsert SQL), `src/plic/cli.py` (`enrich_app`). Tests: mocked psycopg + mocked OpenAI, same style as `tests/test_enrich_worker.py`.

### `migrations/013_embedding.sql`

```sql
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
```
(`empresa_perfil` columns are written by the web side in ticket 72; this migration owns the DDL.)

### `docker-compose.yml`

`image: postgres:16` → `image: pgvector/pgvector:pg16` (same data layout; the existing local volume keeps working). Run `docker compose up -d db` and then `uv run plic db init` to confirm 013 applies locally — include the output in your report.

### `src/plic/llm.py`

- New env `PLIC_LLM_MODEL_EMBED` (default `text-embedding-3-small`), `EMBED_DIMS = 1536`.
- `LlmClient.embed(self, texts: list[str]) -> tuple[list[list[float]], str]` — one `client.embeddings.create(model=..., input=texts)` call (batch ≤ 100 texts; split larger lists), returns vectors in input order + model used. Empty input → `([], model)`. Each text truncated to 8 000 chars before sending.
- Tests in `tests/test_llm.py`: model from env/ctor, batching over 100, order preserved, truncation.

### `src/plic/enrich/embed.py`

- `build_embedding_text(payload_or_row: dict) -> str` — `"{resumo}\n{', '.join(conceitos)}\n{', '.join(palavras_chave)}\n{', '.join(categorias)}"`, skipping empty parts; deterministic, exported, tested.
- `to_pgvector(vec: list[float]) -> str` — `"[" + ",".join(repr-ish floats) + "]"` (psycopg binds it as text; SQL casts `%(embedding)s::vector`).
- `embed_pending(conn, *, limit=None, llm=None) -> dict` counters `{processed, embedded, error}`: selects `enriquecimento` rows with `status='done' AND embedding IS NULL` (order `enriquecido_em DESC`, `LIMIT`), batches of 50 → `llm.embed(texts)` → `UPDATE enriquecimento SET embedding = %(embedding)s::vector, embedding_modelo = %(modelo)s, embedding_em = now(), updated_at = now() WHERE numero_controle_pncp = %(numero)s`, commit per batch. On SDK error: log, stop, return counters (rerun retries).

### `src/plic/enrich/worker.py`

After a successful `validate_payload` and before the upsert in `enrich_one`, call `llm.embed([build_embedding_text(payload)])` and include `embedding`/`embedding_modelo`/`embedding_em = now()` in the same upsert. If the embed call raises, **still persist the enrichment** (status `done`, embedding NULL) and log — `plic enrich embed` backfills later. Never let an embedding failure flip a row to `status='error'`.

### `src/plic/cli.py`

`plic enrich embed [--limit N]` → `embed_pending`, prints `embeddings: N processadas (E ok, X erro)`; exit 1 when `error > 0 and embedded == 0`.

### Tests

- `tests/test_enrich_embed.py`: `build_embedding_text` composition/empties; `to_pgvector` format; `embed_pending` batches (mocked cursor returns 3 rows → one `embed` call, three UPDATEs, one commit), SDK error stops without marking rows.
- `tests/test_enrich_worker.py`: extend existing routing tests — successful row includes `embedding` in the upsert params; embed failure → row still upserted with `status='done'` and `embedding=None`.

## Checks (run in order — cheapest first)
1. `uv run ruff check src tests`
2. `uv run ruff format --check src/plic/enrich src/plic/llm.py tests/test_enrich_embed.py tests/test_enrich_worker.py tests/test_llm.py`
3. `uv run pytest -q`
4. `uv run plic enrich embed --help | grep -q -- --limit`
5. `docker compose up -d db && sleep 3 && uv run plic db init` applies `013_embedding.sql` (or reports up to date on rerun); then `docker compose exec -T db psql -U plic -Atc "select extversion from pg_extension where extname='vector'"` prints a version.

## Done when
- `plic enrich run` writes `embedding` alongside the enrichment; `plic enrich embed` fills NULLs and is a no-op when nothing is pending.
- 013 applies on the local pgvector image and the HNSW index exists (`\d enriquecimento` shows `idx_enriquecimento_embedding`).

## Not included
- Any web/TS change (ticket 72); profile embeddings.
- Query-time semantic search; changing prompts; re-enriching rows.
