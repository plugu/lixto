---
id: 63
status: done
model: opus
depends_on: []
max_attempts: 3
files:
  - migrations/010_enriquecimento.sql
  - src/plic/enrich/__init__.py
  - src/plic/enrich/schema.py
  - src/plic/enrich/documents.py
  - tests/test_enrich_documents.py
  - pyproject.toml
  - uv.lock
---
## Goal
Define the canonical global-enrichment schema (SQL table + LLM JSON schema) and the deterministic edital text-extraction step that feeds it.

## Context

Read `PRODUCT.md` first. This ticket is the contract every other ticket in the cycle codes against: 64 (worker) writes `enriquecimento`, 66 (match engine) and 67 (agent tools) read it. Do not deviate from the column names below — downstream tickets are written against them verbatim.

Conventions: plain-SQL migrations applied in filename order by `src/plic/db.py` (`plic db init`); psycopg 3 with `%(name)s` params; tests fully mocked (no network, no DB) in the style of `tests/test_agents_deep.py`. `f_unaccent(text)` exists (migration 005). Prod Postgres is stock `postgres:18` — **no pgvector**; do not `CREATE EXTENSION vector`.

### `migrations/010_enriquecimento.sql`

```sql
-- Global enrichment: one canonical row per licitação, produced once at
-- ingestion (cycle 16) and reused by every empresa. Never per-tenant.
CREATE TABLE IF NOT EXISTS enriquecimento (
    numero_controle_pncp TEXT PRIMARY KEY REFERENCES licitacao (numero_controle_pncp),
    schema_version TEXT NOT NULL,
    modelo TEXT,
    confianca REAL,
    status TEXT NOT NULL CHECK (status IN ('done', 'error')),
    erro TEXT,
    fonte TEXT NOT NULL CHECK (fonte IN ('estruturado', 'texto', 'pdf')),
    resumo TEXT,
    categorias TEXT[] NOT NULL DEFAULT '{}',
    conceitos TEXT[] NOT NULL DEFAULT '{}',
    palavras_chave TEXT[] NOT NULL DEFAULT '{}',
    cnae_candidatos JSONB NOT NULL DEFAULT '[]',
    requisitos JSONB NOT NULL DEFAULT '[]',
    exige_certificacao BOOLEAN,
    exige_atestado_tecnico BOOLEAN,
    me_epp_exclusivo BOOLEAN,
    me_epp_preferencia BOOLEAN,
    entrega JSONB,
    riscos TEXT[] NOT NULL DEFAULT '{}',
    complexidade TEXT CHECK (complexidade IN ('baixa', 'media', 'alta')),
    dados JSONB NOT NULL,
    enriquecido_em TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_enriquecimento_palavras ON enriquecimento USING gin (palavras_chave);
CREATE INDEX IF NOT EXISTS idx_enriquecimento_conceitos ON enriquecimento USING gin (conceitos);
CREATE INDEX IF NOT EXISTS idx_enriquecimento_categorias ON enriquecimento USING gin (categorias);
CREATE INDEX IF NOT EXISTS idx_enriquecimento_status ON enriquecimento (status);

-- Deterministic text extracted from edital PDFs (pypdf), stored once so the
-- worker never re-downloads and any future re-enrichment reuses it.
CREATE TABLE IF NOT EXISTS documento_texto (
    numero_controle_pncp TEXT NOT NULL,
    sequencial_documento INTEGER NOT NULL,
    metodo TEXT NOT NULL CHECK (metodo IN ('pypdf', 'insuficiente', 'nao_pdf', 'falha')),
    paginas INTEGER,
    chars INTEGER NOT NULL DEFAULT 0,
    texto TEXT,
    extraido_em TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (numero_controle_pncp, sequencial_documento),
    FOREIGN KEY (numero_controle_pncp, sequencial_documento)
        REFERENCES documento (numero_controle_pncp, sequencial_documento)
);
```

`categorias`, `conceitos`, `palavras_chave` are **normalized**: lowercase, accents stripped, trimmed, deduplicated, ≤ 40 chars each — the match engine (ticket 66) compares them with `&&` against the empresa's normalized terms, so normalization must be identical on both sides: `unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower().strip()`, collapse internal whitespace to one space.

### `src/plic/enrich/schema.py`

Export:
- `SCHEMA_VERSION = "1.0"`
- `REQUISITO_TIPOS = ("habilitacao_juridica", "regularidade_fiscal", "qualificacao_tecnica", "qualificacao_economica", "documento", "certificacao", "amostra", "visita_tecnica", "outro")`
- `ENRIQUECIMENTO_SCHEMA: dict` — strict OpenAI `json_schema` (every property required, `additionalProperties: False`, same style as `DEEP_SCHEMA` in `src/plic/agents/deep.py`) with properties: `resumo` (string, ≤ 600 chars asked in prompt), `categorias` (array of string), `conceitos` (array of string), `palavras_chave` (array of string), `cnae_candidatos` (array of `{codigo: string, confianca: number}`), `requisitos` (array of `{tipo: enum REQUISITO_TIPOS, descricao: string}`), `exige_certificacao` (boolean), `exige_atestado_tecnico` (boolean), `me_epp_exclusivo` (boolean), `me_epp_preferencia` (boolean), `entrega` (`{local: string, prazo_dias: integer}` — use `-1` for unknown prazo, `""` for unknown local; strict schemas can't have optional keys), `riscos` (array of string), `complexidade` (enum baixa|media|alta), `confianca` (number 0–1).
- `normalize_term(s: str) -> str` (rule above) and `normalize_terms(xs: list[str]) -> list[str]` (normalize, drop empty, dedupe preserving order, cap 40 chars, max 50 items).
- `validate_payload(payload: Any) -> dict | None` — returns the payload with `categorias`/`conceitos`/`palavras_chave` normalized, `cnae_candidatos` filtered to 7-digit codes (digits only, strip `-`/`/`) with `0 <= confianca <= 1`, `requisitos` filtered to known `tipo`, `entrega.prazo_dias < 0` → `None`, empty `entrega.local` → `None`; returns `None` if not a dict or `complexidade` invalid.

### `src/plic/enrich/documents.py`

Add `pypdf>=5` to `pyproject.toml` dependencies via `uv add pypdf` (this updates `uv.lock`; Dockerfile.cli runs `uv sync --frozen`, so the lock must be committed).

Export:
- `MAX_DOCS = 2`, `MAX_TOTAL_BYTES = 30 * 1024 * 1024`, `MAX_TEXT_CHARS = 200_000`, `MIN_CHARS_PER_PAGE = 200`, `MIN_TOTAL_CHARS = 500`.
- `extract_text(pdf_bytes: bytes) -> tuple[str, int]` — pypdf `PdfReader(BytesIO(...))`, concatenate `page.extract_text() or ""` with `\n\n`, return `(text[:MAX_TEXT_CHARS], page_count)`. Any pypdf exception → raise (caller maps to `falha`).
- `classify_extraction(text: str, paginas: int) -> str` — `'pypdf'` if `len(text) >= MIN_TOTAL_CHARS and paginas > 0 and len(text) / paginas >= MIN_CHARS_PER_PAGE`, else `'insuficiente'`.
- `pick_documents(conn, numero) -> list[dict]` — same SQL as `src/plic/agents/deep.py::_SELECT_DOCS_SQL` (edital first, active only). Copy it; do not import from `agents.deep` (that module loads `company_profile.md`).
- `extract_for_licitacao(conn, numero, http_client) -> list[dict]` — for up to `MAX_DOCS` documents (in `pick_documents` order): if a `documento_texto` row already exists, reuse it; otherwise download (follow redirects, 60 s timeout, sniff `%PDF-` magic like `deep.download_pdfs`), non-PDF → row `metodo='nao_pdf'`; download/parse error → `metodo='falha'`, `chars=0`; else `extract_text` + `classify_extraction` → row with `texto` (store text even when `insuficiente`; it's cheap and useful), `paginas`, `chars`. Upsert (`ON CONFLICT DO UPDATE`), commit per document. Returns list of `{sequencial_documento, metodo, paginas, chars, texto, pdf_bytes}` where `pdf_bytes` is the freshly downloaded content or `None` when reused from DB (the worker needs bytes only for the Tier-2 PDF path; it re-downloads in that case). Skip further downloads once combined bytes exceed `MAX_TOTAL_BYTES`.

### Tests (`tests/test_enrich_documents.py`)

- `normalize_term("Lápis Preto  nº 2 ") == "lapis preto no 2"`-style cases (accents, case, whitespace), `normalize_terms` dedupes and caps.
- `validate_payload`: strips invalid CNAE codes, drops unknown requisito tipos, maps `prazo_dias=-1` → `None`, rejects bad complexidade.
- `classify_extraction`: 3 pages × 1,000 chars → `pypdf`; 10 pages × 20 chars → `insuficiente`; empty → `insuficiente`.
- `extract_text` on a tiny PDF generated in-test with `pypdf.PdfWriter` (blank page → empty text, page count 1).
- `extract_for_licitacao` with a MagicMock connection (cursor `fetchall` returns two doc rows; one already in `documento_texto`) and a mocked `httpx.Client` returning `%PDF-` bytes: asserts one download, one upsert, and the reused row carries `pdf_bytes=None`.

## Checks (run in order — cheapest first)
1. `uv run ruff check src tests`
2. `uv run ruff format --check src/plic/enrich tests/test_enrich_documents.py` (repo-wide format check fails on 17 pre-existing files — out of scope)
3. `uv run pytest -q`
4. `grep -q "pypdf" uv.lock`

## Done when
- `plic db init` on an empty DB applies 010 without error (verify with `docker compose up -d db && uv run plic db init` if the local DB is available; otherwise the migration test in `tests/test_migrations.py` still passes and the SQL parses).
- `validate_payload` + `normalize_term` behave per the tests; `documento_texto` rows are produced by `extract_for_licitacao` with the mocked client.

## Not included
- Any LLM call, the worker loop, or CLI command (ticket 64).
- Changes to `src/plic/agents/*` — legacy triage/deep pipeline stays untouched this cycle.
- pgvector / embeddings.
- OCR for scanned PDFs (the `insuficiente` marker is what routes them to the multimodal tier in 64).
