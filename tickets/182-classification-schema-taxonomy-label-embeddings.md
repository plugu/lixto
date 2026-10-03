---
id: 182
status: done
model: sonnet
depends_on: []
max_attempts: 3
files:
  - migrations/009_classification.sql
  - src/lixto/classify/__init__.py
  - src/lixto/classify/taxonomy.py
  - src/lixto/classify/labels.py
  - src/lixto/cli/classify.py
  - tests/conftest.py
  - tests/test_classify_taxonomy.py
  - tests/test_classify_labels.py
---
## Goal
Schema + closed taxonomy + label embeddings exist, so a tender can be classified against CNAE subclasses and segments by cosine distance.

## Context
Cycle 32 (PRODUCT.md). Today `procurement_cnaes` (001_core.sql:252-259) only allows `origin = 'enrichment'` (implicit constraint name `procurement_cnaes_origin_check`; widening pattern in 002_document_texts_ocr.sql:7-9 and 008_cases.sql:52-56). `cnae_codes` (001_core.sql:23-28: `code CHAR(7) PK, description, division CHAR(2), division_description`) is seeded by `lixto cnae seed`. Vectors are written as text and cast with `::vector` (`lixto.enrich.embed.to_pgvector`, embed.py:140); HNSW index pattern at 001_core.sql:267. `LlmClient.embed(texts) -> (vectors, model)` (llm.py:417) batches 100, 1536 dims, no fallback. CLI groups are auto-discovered: a module in `src/lixto/cli/` exporting `name = "classify"` + `app = typer.Typer(...)` mounts as `lixto classify …` (pattern: `src/lixto/cli/enrich.py`, which uses `db.get_connection()`, `runs.run(conn, kind)`, `typer.echo`). Migration style: `migrations/008_cases.sql` (header comment `-- Cycle 32 (ticket 182): …`, no BEGIN/COMMIT, indexes after each table). `tests/conftest.py:84-106` truncates every public table except `sources`, `schema_migrations`, `cnae_codes`; the new seed table must join that list.

### Work
1. `migrations/009_classification.sql`:
   - Widen `procurement_cnaes_origin_check` to `CHECK (origin IN ('enrichment','ingest'))`.
   - `classification_segments (code TEXT PRIMARY KEY, label TEXT NOT NULL, description TEXT NOT NULL, sort_order INTEGER NOT NULL UNIQUE, embedding vector(1536), embedding_model TEXT, embedded_at TIMESTAMPTZ)` and INSERT the 24 rows from the taxonomy below (same text as the Python module, verbatim).
   - `cnae_code_embeddings (cnae_code CHAR(7) PRIMARY KEY REFERENCES cnae_codes (code) ON DELETE CASCADE, model TEXT NOT NULL, embedding vector(1536) NOT NULL, embedded_at TIMESTAMPTZ NOT NULL DEFAULT now())`.
   - `procurement_classifications (procurement_id BIGINT PRIMARY KEY REFERENCES procurements (id) ON DELETE CASCADE, schema_version TEXT NOT NULL, model TEXT, status TEXT NOT NULL CHECK (status IN ('done','error')), error TEXT, segment TEXT REFERENCES classification_segments (code), segment_confidence REAL, segment_source TEXT CHECK (segment_source IN ('llm','cosine')), nature TEXT CHECK (nature IN ('bens','servicos','obras')), keywords TEXT[] NOT NULL DEFAULT '{}', data JSONB NOT NULL DEFAULT '{}', classified_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`; indexes: `(segment)`, `(status)`, GIN on `keywords`, `(classified_at DESC)`.
2. `src/lixto/classify/taxonomy.py`: `NATURES = ("bens", "servicos", "obras")`; `@dataclass(frozen=True) Segment(code, label, description, sort_order)`; `SEGMENTS: tuple[Segment, ...]` (24, in this order, codes are the facet values, labels pt-BR shown to users, descriptions are what gets embedded and what the LLM reads):
   1. `informatica` — Informática e telecom — Equipamentos de informática, software, licenças, serviços de TI, telefonia, redes, impressão/outsourcing de impressão.
   2. `saude` — Saúde e hospitalar — Medicamentos, materiais médico-hospitalares, equipamentos médicos e odontológicos, serviços de saúde, exames.
   3. `alimentacao` — Alimentação — Gêneros alimentícios, merenda escolar, refeições prontas, coffee break, água mineral, hortifrúti.
   4. `obras` — Obras e construção — Execução de obras, reformas, pavimentação, construção civil, drenagem, edificações.
   5. `engenharia_servicos` — Serviços de engenharia e projetos — Projetos de engenharia e arquitetura, fiscalização, laudos, topografia, consultoria técnica de obras.
   6. `materiais_construcao` — Materiais de construção — Cimento, areia, brita, tintas, material elétrico e hidráulico, ferragens para obras.
   7. `limpeza` — Limpeza e higiene — Serviços de limpeza e conservação, materiais de limpeza, higiene, descartáveis, coleta de resíduos.
   8. `veiculos_transporte` — Veículos e transporte — Veículos, peças e pneus, manutenção de frota, locação de veículos, transporte de pessoas e cargas.
   9. `combustiveis` — Combustíveis e lubrificantes — Gasolina, diesel, etanol, GLP, lubrificantes, gestão de abastecimento.
   10. `mobiliario` — Mobiliário e eletrodomésticos — Móveis, cadeiras, armários, eletrodomésticos, eletroportáteis, utensílios.
   11. `papelaria` — Papelaria, gráfica e expediente — Material de expediente, papel, toner, impressos gráficos, carimbos, encadernação.
   12. `vestuario_epi` — Vestuário e EPI — Uniformes, fardamentos, calçados, equipamentos de proteção individual, enxoval.
   13. `seguranca` — Segurança e vigilância — Vigilância armada/desarmada, monitoramento, CFTV, alarmes, controle de acesso, extintores, brigada.
   14. `educacao` — Educação e material didático — Material didático e pedagógico, livros, brinquedos, mobiliário escolar, serviços educacionais.
   15. `eventos_comunicacao` — Eventos e comunicação — Organização de eventos, locação de estruturas, som e iluminação, publicidade, comunicação visual, brindes.
   16. `terceirizacao_apoio` — Terceirização e apoio administrativo — Mão de obra terceirizada, recepção, portaria, copeiragem, motoristas, apoio administrativo, estagiários.
   17. `manutencao_predial` — Manutenção predial e de equipamentos — Manutenção de ar-condicionado, elevadores, geradores, instalações elétricas e hidráulicas, jardinagem, dedetização.
   18. `energia_agua_saneamento` — Energia, água e saneamento — Energia elétrica, iluminação pública, painéis solares, abastecimento de água, esgoto, tratamento de resíduos.
   19. `agropecuaria` — Agropecuária e meio ambiente — Insumos agrícolas, sementes, máquinas agrícolas, medicamentos veterinários, animais, reflorestamento, serviços ambientais.
   20. `laboratorio` — Laboratório e científico — Reagentes, vidraria, equipamentos de laboratório, análises laboratoriais, insumos de pesquisa.
   21. `consultoria_servicos_profissionais` — Consultoria e serviços profissionais — Consultoria, auditoria, assessoria jurídica e contábil, treinamento, capacitação, pesquisas, serviços especializados.
   22. `locacao_imoveis` — Locação de imóveis e espaços — Locação de imóveis, salas, galpões, terrenos, espaços para eventos.
   23. `cultura_esporte` — Cultura, esporte e lazer — Instrumentos musicais, equipamentos esportivos, materiais de educação física, shows artísticos, acervos culturais.
   24. `outros` — Outros — Objetos que não se encaixam em nenhum dos segmentos anteriores.
   Also `SEGMENT_CODES: frozenset[str]`, `segment_by_code(code) -> Segment | None`.
3. `src/lixto/classify/labels.py`: `embed_labels(conn, *, llm: LlmClient | None = None, counters: RunCounters | None = None, force: bool = False) -> dict[str, int]`: embed every `cnae_codes` row lacking a `cnae_code_embeddings` row (or all, with `force`) using text `f"{description} ({division_description})"`, upsert `(cnae_code, model, embedding::vector)`; embed every `classification_segments` row with NULL `embedding` (or all, with `force`) using `f"{label}: {description}"`, update `embedding`, `embedding_model`, `embedded_at`. Batches of 100 via `llm.embed`; commit per batch; counters `cnae_embedded`, `segments_embedded`. Build `LlmClient()` lazily when `llm` is None. Also `verify_taxonomy(conn) -> list[str]`: returns the segment codes present in `SEGMENTS` but missing from the table (and vice versa), so the CLI can refuse to run on a drifted seed.
4. `src/lixto/cli/classify.py`: `name = "classify"`, `app`; command `embed-labels [--force]` running `embed_labels` inside `runs.run(conn, "classify.labels")`, echoing counts, exit 1 if `verify_taxonomy` reports drift (print the codes). Leave room for `run`/`export` (ticket 183) but do not implement them.
5. `tests/conftest.py`: add `classification_segments` to the truncate exclusion tuple.
6. Tests (pure, no DB): `tests/test_classify_taxonomy.py` — 24 segments, unique codes and sort_orders, `outros` last, every code is `[a-z_]+`; the INSERT in `migrations/009_classification.sql` lists exactly `SEGMENT_CODES` (regex the file for `('code',`-style tuples or a clearly delimited VALUES block — choose a format in the migration that makes this parse trivial, e.g. one `('code', 'label', 'description', N)` per line) and the 24 labels match. `tests/test_classify_labels.py` — with a `MagicMock` conn (cursor rows for missing CNAEs/segments) and a mocked `llm.embed` returning 4-dim vectors (`tests/test_enrich_embed.py:27-40` shows both helpers), assert upsert SQL targets `cnae_code_embeddings`, segment UPDATE targets `classification_segments`, batches of ≤100, counters, and `force=True` selects all rows.

## Checks (run in order — cheapest first)
1. `uv run ruff check src tests && uv run ruff format --check src tests`
2. `uv run pytest -q tests/test_classify_taxonomy.py tests/test_classify_labels.py tests/test_cli_discovery.py`
3. `uv run lixto db init > /dev/null && docker compose exec -T db psql -U lixto -d lixto -Atc "SELECT count(*) FROM classification_segments" | grep -qx 24`
4. `docker compose exec -T db psql -U lixto -d lixto -Atc "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'procurement_cnaes_origin_check'" | grep -q "'ingest'"`
5. `uv run lixto classify embed-labels --help | grep -q -- --force`

## Done when
- Migration applies on the dev DB; `classification_segments` has 24 rows; `procurement_cnaes` accepts `origin = 'ingest'`.
- `lixto classify embed-labels` fills `cnae_code_embeddings` and segment embeddings (running it for real needs an embedding key; the owner runs it once in prod and once locally).

## Not included
- `lixto classify run`, the LLM prompt, any write to `procurement_classifications` (183); analyze worker changes (184); web (185/186); docs (187).
- CNAE→segment mapping for companies; editing `cnae_seed.py`.
