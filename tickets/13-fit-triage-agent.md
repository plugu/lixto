---
id: 13
status: done
model: sonnet
depends_on: []
max_attempts: 3
files:
  - migrations/006_analise.sql
  - company_profile.md
  - src/plic/agents/__init__.py
  - src/plic/agents/profile.py
  - src/plic/agents/triage.py
  - src/plic/agents/run.py
  - src/plic/cli.py
  - src/plic/settings.py
  - pyproject.toml
  - tests/test_agents_triage.py
---
## Goal
Fit-triage agent end-to-end: `plic agents run` scores every new top-7 licitação against `company_profile.md` via Claude Haiku and persists verdicts in a new `analise` table.

## Context
Add dep `openai>=1.60`. New migration `006_analise.sql`: table `analise` (`numero_controle_pncp` TEXT PK REFERENCES licitacao, `fit_score` INT, `verdict` TEXT CHECK IN ('fit','no_fit','borderline'), `reasoning` TEXT, `triage_model` TEXT, `triaged_at` TIMESTAMPTZ, `deep_verdict` TEXT, `requirements` JSONB, `risks` JSONB, `prazos` JSONB, `deep_model` TEXT, `deep_analyzed_at` TIMESTAMPTZ, `deep_status` TEXT DEFAULT NULL, `error` TEXT, `created_at`/`updated_at` TIMESTAMPTZ NOT NULL DEFAULT now()); index on `verdict`.

`company_profile.md`: markdown template with sections — Empresa, CNAEs, O que fornecemos, Palavras-chave, Exclusões, Faixa de valor, UFs de interesse — filled with clearly-marked placeholder content (`<preencher>`). `profile.py` loads it (path via `PLIC_PROFILE_PATH`, default repo-root `company_profile.md`; walk up from module like `db.MIGRATIONS_DIR` does).

`triage.py` mirrors `classify.py`'s structure (batch select → LLM → update → commit, resumable). Selection: licitações with no `analise` row, `usuario_nome` in the top-7 allowlist (duplicate the 7 names from `web/lib/portais.ts` `PORTAIS_ATIVOS` as a Python constant), and aberta/futura (same date predicate as `classify.py`). Per licitação send: objeto (600 chars), modalidade_nome, setor, uf, municipio, valor_total_estimado, up to 10 item descriptions (100 chars each). Batch of 10 per API call. Use `openai.OpenAI()` client (reads `OPENAI_API_KEY`), Responses API `client.responses.create(...)`, model `gpt-5-mini` (env `PLIC_TRIAGE_MODEL`), structured outputs via `text={"format": {"type": "json_schema", "name": "triage", "strict": True, "schema": ...}}` returning `{"results": [{n, fit_score (0-100), verdict, reasoning (<=300 chars)}]}` (strict mode: all fields required, `additionalProperties: false`); parse `response.output_text` with `json.loads`. On API error: log, stop the run (don't mark rows). Unparseable entry → skip row (stays queued).

`run.py`: `run_agents(conn, *, max_triage, max_deep)` — calls triage; deep is a no-op stub returning 0 until ticket 14. CLI: `plic agents run --max-triage N --max-deep N` (defaults 200/20) registered as `agents` sub-app in `cli.py`, echoing counters like other commands.

Tests mirror `test_classify.py`: mock the OpenAI client (no network); cover selection SQL (allowlist + no-analise + date predicate), prompt build, schema-result persistence, resumability (second run skips analysed rows), API-error stop.

## Checks (run in order — cheapest first)
1. `uv run ruff check src tests`
2. `uv run pytest tests/test_agents_triage.py tests/test_migrations.py`
3. `uv run plic db init`
4. `set -a && source ~/dev/hackaview/.env && set +a && uv run plic agents run --max-triage 2 --max-deep 0`

## Done when
- Check 4 exits 0 and `analise` has 2 rows with verdict + reasoning + score; re-running processes 2 different rows (resumable).

## Not included
- Deep analysis (ticket 14) — leave `deep_*` columns NULL and the stub in place. No web UI (ticket 15). No batch API, no retries beyond SDK defaults, no LangGraph. Don't touch sync/classify code.
