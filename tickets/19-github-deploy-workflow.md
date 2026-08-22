---
id: 19
status: done
model: haiku
depends_on: []
max_attempts: 3
files:
  - .github/workflows/deploy.yml
  - .env.example
---
## Goal
Repo carries the GitHub Actions workflow that triggers a Dokploy deploy on every push to `main`, and `.env.example` documents every runtime env var.

## Context
Copy `~/dev/vps-infra/template/.github/workflows/deploy.yml` **verbatim** into `.github/workflows/deploy.yml` (it builds the GitHub-shaped payload Dokploy's webhook needs; a bare curl does not work — see its header comment). Keep `branches: [main]`. Add an `on.push.paths` filter so only changes that affect the web image trigger a deploy:
```yaml
    paths:
      - "web/**"
      - ".github/workflows/deploy.yml"
```
The secret `DOKPLOY_DEPLOY_WEBHOOK` is set later by the orchestrator (ticket 21) — do not try to set it.

`.env.example` (root) currently has `PLIC_DATABASE_URL` and `PLIC_MIN_REQUEST_INTERVAL`. Add a commented header explaining: web app and CLI both read `PLIC_DATABASE_URL`; on Dokploy it points at the shared-infra Postgres; `OPENAI_API_KEY` only needed for `plic agents run` (not deployed). Keep existing values.

The GitHub repo itself is created by the orchestrator (live step, needs confirmation) — this ticket only adds files.

## Checks (run in order — cheapest first)
1. `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/deploy.yml'))"` (if PyYAML missing: `uv run --with pyyaml python -c "..."`)
2. `diff <(sed -n '/^name: Deploy/,$p' ~/dev/vps-infra/template/.github/workflows/deploy.yml | grep -v '^\s*paths' ) <(sed -n '/^name: Deploy/,$p' .github/workflows/deploy.yml | grep -v '^\s*paths\|^\s*- "web/\*\*"\|^\s*- ".github/workflows/deploy.yml"')` — exits 0 when the only difference is the paths filter
3. `grep -q PLIC_DATABASE_URL .env.example`

## Done when
- Workflow file present and valid YAML, identical to the template apart from the paths filter; `.env.example` documents the vars.

## Not included
- No `gh repo create`, no `gh secret set`, no pushes, no Dockerfiles.
