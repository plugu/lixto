---
id: 50
status: done
model: sonnet
depends_on: []
max_attempts: 3
files:
  - migrations/008_cnae.sql
  - src/plic/cnae_seed.py
  - src/plic/cli.py
  - tests/test_cnae_seed.py
---
## Goal
Add the CNAE reference table + `licitacao_cnae` schema, and a `plic cnae seed` command that loads all ~1359 IBGE subclasses.

## Context
Follow the plain-SQL migration pattern (`migrations/004_setor.sql`, runner in `src/plic/db.py`, applied via `plic db init`). `008_cnae.sql` creates:
- `cnae (codigo CHAR(7) PRIMARY KEY, descricao TEXT NOT NULL, divisao CHAR(2) NOT NULL, divisao_descricao TEXT NOT NULL)`
- `licitacao_cnae (numero_controle_pncp TEXT NOT NULL, codigo CHAR(7) NOT NULL REFERENCES cnae, confidence REAL, PRIMARY KEY (numero_controle_pncp, codigo))` + index on `codigo`
- `ALTER TABLE licitacao ADD COLUMN IF NOT EXISTS cnae_classificado_em TIMESTAMPTZ`

`cnae_seed.py`: fetch `https://servicodados.ibge.gov.br/api/v2/cnae/subclasses` with httpx (one GET, big JSON array; each entry has `id` = 7-digit codigo, `descricao`, and nested `classe.grupo.divisao` with `id`/`descricao`). Pure function maps JSON → row params; upsert `ON CONFLICT (codigo) DO UPDATE`. CLI: add a `cnae` typer sub-app to `src/plic/cli.py` (pattern: existing commands there) with `seed` command printing the row count. Tests use a small inline JSON fixture — no network, mock connection like `tests/test_db.py`.

## Checks (run in order — cheapest first)
1. `uv run ruff check`
2. `uv run pytest tests/test_cnae_seed.py`
3. `uv run pytest`

## Done when
- `plic db init && plic cnae seed` leaves ≥1300 rows in `cnae`, rerunning is idempotent.
- `licitacao_cnae` and `licitacao.cnae_classificado_em` exist.

## Not included
- Any classification logic or Ollama calls (ticket 51).
- Web changes (ticket 52).
- Seção/grupo levels — divisão + subclasse are enough for the two-stage prompt.
