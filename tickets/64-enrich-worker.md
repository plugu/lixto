---
id: 64
status: todo
model: opus
depends_on: [63]
max_attempts: 3
files:
  - src/plic/llm.py
  - src/plic/enrich/worker.py
  - src/plic/cli.py
  - tests/test_llm.py
  - tests/test_enrich_worker.py
---
## Goal
`plic enrich run` produces one canonical `enriquecimento` row per pending open licitação, routing each to the cheapest LLM tier that can handle it, through a provider-abstracted client.

## Context

Read `PRODUCT.md` and ticket 63 (schema, `validate_payload`, `extract_for_licitacao`). Mirror the shape of `src/plic/agents/deep.py`: select → per-row LLM → persist → **commit per row** so a crash loses only the in-flight licitação. Tests: fully mocked psycopg + mocked LLM client, like `tests/test_agents_deep.py`.

### `src/plic/llm.py` — provider abstraction

One module the whole Python side uses from now on. Env (all optional):
- `PLIC_LLM_BASE_URL` (default: unset → OpenAI), `PLIC_LLM_API_KEY` (fallback `OPENAI_API_KEY`).
- `PLIC_LLM_MODEL_CHEAP` default `gpt-5-mini` — Tier 1 (clean text).
- `PLIC_LLM_MODEL_DOC` default `gpt-5.1` — Tier 2 (PDF input; OpenAI Responses API only).
- `PLIC_LLM_MODEL_STRONG` default `gpt-5.1` — Tier 3 (not used this ticket; expose it).
- `PLIC_LLM_MODEL_FALLBACK` default unset — if set, one retry on the fallback model after a tier-1 failure.

Export:
```python
class LlmClient:
    def __init__(self, client: OpenAI | None = None, *, cheap=None, doc=None, strong=None, fallback=None): ...
    def complete_json_text(self, *, tier: str, instructions: str, prompt: str, schema: dict, name: str) -> tuple[dict | None, str]:
        """Chat Completions with response_format json_schema (portable across
        OpenAI-compatible providers). Returns (parsed dict or None, model_used)."""
    def complete_json_pdf(self, *, instructions: str, prompt: str, pdfs: list[dict], schema: dict, name: str) -> tuple[dict | None, str]:
        """Responses API with input_file PDFs (OpenAI only) — same content
        shape as agents/deep.py::build_input_content."""
```
`tier` ∈ `{"cheap","strong"}`. JSON parsing tolerant (`json.loads`, None on failure or refusal). Errors from the SDK propagate (the worker catches per row). `tests/test_llm.py`: mocked `OpenAI` object — asserts model selection per tier, `response_format` payload, fallback retry fires once only when configured.

### `src/plic/enrich/worker.py`

Constants: `BATCH_LIMIT_DEFAULT = 200`, `MAX_ITENS = 40`, `ITEM_CHARS = 160`, `OBJETO_CHARS = 2000`, `CONTEXT_TEXT_CHARS = 60_000`.

Select SQL (`_SELECT_PENDING_SQL`): licitações where `usuario_nome = ANY(%(portais)s)` (copy `PORTAIS_ATIVOS` from `src/plic/agents/triage.py` — do not import that module), `(data_encerramento_proposta >= now() OR data_abertura_proposta > now())`, `NOT EXISTS (SELECT 1 FROM enriquecimento e WHERE e.numero_controle_pncp = l.numero_controle_pncp)`, optional `%(days)s` window on `data_publicacao_pncp` exactly like `src/plic/cnae_match.py::_SELECT_BATCH_SQL`, `ORDER BY data_encerramento_proposta ASC NULLS LAST LIMIT %(limit)s`. Columns: `numero_controle_pncp, objeto_compra, informacao_complementar, modalidade_nome, uf, municipio_nome, valor_total_estimado, data_encerramento_proposta, srp, orgao_razao_social`.

Itens SQL: `descricao, quantidade, unidade_medida, valor_unitario_estimado, material_ou_servico` ordered by `numero_item LIMIT MAX_ITENS`.

Per licitação (`enrich_one(conn, row, *, llm, http_client) -> str` returning `'done'|'error'`):
1. `docs = extract_for_licitacao(conn, numero, http_client)` (ticket 63).
2. Build `prompt` = structured summary (objeto, informação complementar, modalidade, UF/município, valor estimado, SRP, encerramento, itens as `n. descricao — qtd unidade — R$ valor_unit`) + `## Texto do edital` with the concatenated `texto` of docs whose `metodo == 'pypdf'`, capped at `CONTEXT_TEXT_CHARS`.
3. Routing:
   - any doc `metodo == 'pypdf'` → `fonte='texto'`, `llm.complete_json_text(tier="cheap", ...)`.
   - no `pypdf` doc but ≥ 1 doc with `metodo == 'insuficiente'` → `fonte='pdf'`: re-download those PDFs' bytes (use `pdf_bytes` if present, else `http_client.get(url)`), `llm.complete_json_pdf(...)` (cap 2 PDFs / 30 MB; if over cap fall through to the next bullet).
   - otherwise → `fonte='estruturado'`, cheap tier on the structured summary alone.
4. `payload = validate_payload(result)`; `None` → `status='error', erro='resposta inválida'`.
5. Upsert into `enriquecimento` with `schema_version=SCHEMA_VERSION`, `modelo=model_used`, `confianca=payload['confianca']`, columns mapped 1:1, `dados=json.dumps(payload)`, `riscos`, arrays as Python lists (psycopg adapts `list[str]` → `text[]`). On exception: log, upsert `status='error', erro=str(exc)[:2000], fonte` (still commits so the row leaves the queue; rerun with `--retry-errors` re-selects `status='error'` rows).

Instructions (system prompt, PT-BR): "Você é um analista de licitações públicas. Extraia do edital e dos dados estruturados uma representação canônica…", listing every field with one-line definitions; insist `categorias`/`conceitos`/`palavras_chave` are lowercase nouns in Portuguese without accents, `palavras_chave` include synonyms buyers use (ex.: "lapis", "lapis preto", "material escolar"); `cnae_candidatos` are IBGE subclasses `0000-0/00`; `me_epp_exclusivo` true only when the edital says participation is exclusive to ME/EPP (Lei 123 art. 48 I); `confianca` reflects how much of the answer came from the edital text vs guesswork. Keep the instructions as a module constant `INSTRUCTIONS` (tests assert field names appear in it).

`enrich(conn, *, limit=None, days=None, retry_errors=False, llm=None, http_client=None) -> dict` counters `{processed, done, error}`; owns/close the `httpx.Client` like `deep_analyze`.

### `src/plic/cli.py`

Add `enrich_app = typer.Typer(help="Global enrichment commands")` mounted as `enrich`, command `run` with `--limit`, `--days`, `--retry-errors`, printing `enriquecidas: N (done D, error E)`; exit 1 when `error > 0 and done == 0` (total failure — usually a bad key/URL).

### Tests (`tests/test_enrich_worker.py`)

- `build_prompt` includes objeto, up to `MAX_ITENS` itens, edital text capped at `CONTEXT_TEXT_CHARS`.
- routing: pypdf doc → `complete_json_text` called with `tier="cheap"` and `fonte='texto'`; only insuficiente docs → `complete_json_pdf` and `fonte='pdf'`; no docs → `fonte='estruturado'`.
- invalid payload → `status='error'` row upserted, commit still called.
- SDK exception → `status='error'` with message, next row still processed.
- `--days` and `--retry-errors` change the SQL params / selected predicate.

## Checks (run in order — cheapest first)
1. `uv run ruff check src tests`
2. `uv run ruff format --check src tests`
3. `uv run pytest -q`
4. `uv run plic enrich run --help | grep -q -- --retry-errors`
5. If `PLIC_LLM_API_KEY` or `OPENAI_API_KEY` is set and the local DB is up: `uv run plic enrich run --limit 1 --days 30` exits 0 and `docker compose exec -T db psql -U plic -c "select numero_controle_pncp, fonte, status, array_length(palavras_chave,1) from enriquecimento limit 3"` shows a row. Otherwise skip and say so in the receipt.

## Done when
- Running `plic enrich run --limit N` fills `enriquecimento` rows with `fonte` reflecting the route taken, and reruns are no-ops for already-enriched licitações.
- No module under `src/plic/enrich/` imports `plic.agents.*` or reads `company_profile.md`.

## Not included
- Embeddings / pgvector; CNAE re-tagging (the `licitacao_cnae` pipeline stays as the CNAE source of truth; `cnae_candidatos` is informational).
- Touching `src/plic/agents/*`, README or Dokploy schedules (ticket 70).
- Streaming, parallelism, or a queue — sequential per row is the mvp shortcut.
