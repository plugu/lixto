---
id: 53
status: done
model: haiku
depends_on: [51]
max_attempts: 3
files:
  - src/plic/cnae_match.py
  - src/plic/cli.py
  - README.md
---
## Goal
`plic cnae eval` dry-run command for manual model comparison, plus README docs for the CNAE pipeline and remote-Ollama setup.

## Context
Add `plic cnae eval --limit 20` to the `cnae` typer sub-app: runs the ticket-51 two-stage classification on pending rows but **persists nothing** — prints per licitação: numero_controle_pncp, objeto (truncated 80 chars), and each chosen `codigo — descricao (confidence)`. Purpose: run twice with `PLIC_CNAE_MODEL=gemma3:12b` vs `gpt-oss:20b` and eyeball quality before fixing the default. Reuse `cnae_match.py` functions; add a small eval entry point there if needed (no logic duplication).

README: new "CNAE matching" section under CLI Commands — commands (`cnae seed|classify|eval`), env vars (`PLIC_OLLAMA_URL`, `PLIC_CNAE_MODEL`), and remote-Ollama note: host runs Ollama with `OLLAMA_HOST=0.0.0.0:11434` (or `tailscale serve`), consumer sets `PLIC_OLLAMA_URL=http://plugu-local-m4:11434` over Tailscale; laptop offline is safe — unstamped rows retry next run.

## Checks (run in order — cheapest first)
1. `uv run ruff check`
2. `uv run pytest`

## Done when
- `plic cnae eval --limit 5` prints readable tags and leaves `licitacao_cnae` + stamps untouched.
- README documents the three commands, env vars, and Tailscale setup.

## Not included
- Automated accuracy metrics or labeled-dataset tooling — eyeball eval only.
- Scheduler/plist changes (`plic sync incremental` wiring stays as is; running `cnae classify` stays manual/cron for now).
- Changing the default model.
