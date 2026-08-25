---
id: 85
status: doing
model: sonnet
depends_on: [83]
max_attempts: 4
files:
  - src/plic/**
  - tests/test_*.py
  - tests/fixtures/**
  - legacy/**
  - company_profile.md
  - scripts/seed_open.sh
  - pyproject.toml
  - uv.lock
  - docs/TENANT.md
  - docs/cycles/**
  - docs/design/**
  - tickets/10-*.md
  - tickets/11-*.md
  - tickets/12-*.md
  - tickets/13-*.md
  - tickets/14-*.md
  - tickets/15-*.md
  - tickets/16-*.md
  - tickets/17-*.md
  - tickets/18-*.md
  - tickets/19-*.md
  - tickets/20-*.md
  - tickets/21-*.md
  - tickets/22-*.md
  - tickets/23-*.md
  - tickets/24-*.md
  - tickets/25-*.md
  - tickets/26-*.md
  - tickets/27-*.md
  - tickets/28-*.md
  - tickets/29-*.md
  - tickets/30-*.md
  - tickets/31-*.md
  - tickets/32-*.md
  - tickets/33-*.md
  - tickets/34-*.md
  - tickets/35-*.md
  - tickets/36-*.md
  - tickets/37-*.md
  - tickets/38-*.md
  - tickets/39-*.md
  - tickets/40-*.md
  - tickets/41-*.md
  - tickets/42-*.md
  - tickets/43-*.md
  - tickets/44-*.md
  - tickets/45-*.md
  - tickets/46-*.md
  - tickets/47-*.md
  - tickets/48-*.md
  - tickets/49-*.md
  - tickets/50-*.md
  - tickets/51-*.md
  - tickets/52-*.md
  - tickets/53-*.md
  - tickets/54-*.md
  - tickets/55-*.md
  - tickets/56-*.md
  - tickets/57-*.md
  - tickets/58-*.md
  - tickets/59-*.md
  - tickets/60-*.md
  - tickets/61-*.md
  - tickets/62-*.md
  - tickets/63-*.md
  - tickets/64-*.md
  - tickets/65-*.md
  - tickets/66-*.md
  - tickets/67-*.md
  - tickets/68-*.md
  - tickets/69-*.md
  - tickets/70-*.md
  - tickets/71-*.md
  - tickets/72-*.md
  - tickets/73-*.md
  - web/app/(app)/invite/**
  - web/app/(app)/company/actions.ts
  - web/app/(app)/company/users/actions.ts
  - web/app/(app)/login/**
  - web/app/(app)/signup/actions.ts
  - web/components/company-form.tsx
  - web/components/invite-form.tsx
  - web/components/users-table.tsx
  - web/components/signup-form.tsx
  - web/components/profile-form.tsx
  - web/vitest.config.ts
---
## Goal
No legacy code, schema, config or docs remain in the repo — only Lixto.

## Context

Read `PRODUCT.md`. Everything the new tickets ported from is now dead. Delete (git rm): `src/plic/`, legacy `tests/test_*.py` at the top level (new tests live in `tests/lixto/`), `tests/fixtures/` if only legacy used them (check imports), `legacy/migrations/`, `company_profile.md`, `scripts/seed_open.sh`, `docs/TENANT.md` (86 writes the replacement), `docs/cycles/`, `docs/design/` (keep content only if `docs/WEB_STYLE.md` references it — then move the referenced file next to it), and tickets `10`–`73` (history lives in git). `pyproject.toml`: packages `["src/lixto"]`, scripts only `lixto`, `uv lock`. Then flatten `tests/lixto/*` into `tests/` (git mv) and fix imports.

Web leftovers (from ticket 82's report): rename the cross-cutting Portuguese identifiers `erro` → `error` and `mensagem` → `message` in `web/app/(app)/{invite/[token],company,company/users,login,signup}/actions.ts` and the forms that read that state (`web/components/{company-form,invite-form,users-table,signup-form,profile-form}.tsx`, login page) — add those files to your `files:`; UI copy stays Portuguese. Add `web/vitest.config.ts` with `test.exclude` covering `.next/**` and `node_modules/**` so a post-build `vitest run` doesn't discover `.next/standalone` copies (verify `npm test` still reports 19 files).

## Checks (run in order — cheapest first)
1. `! test -d src/plic && ! test -d legacy && ! test -f company_profile.md`
2. `! grep -rn "plic\b\|from plic\|import plic\|PLIC_" src tests web/lib web/app web/components pyproject.toml Dockerfile.cli docker-compose.yml .github`
3. `uv run ruff check src tests && uv run ruff format --check src tests`
4. `uv run pytest -q`
5. `cd web && npx tsc --noEmit && npm run lint && npm test && npm run build`
6. `! grep -rEn "\b(erro|mensagem)\b" web/app web/components web/lib --include='*.ts' --include='*.tsx' | grep -v '"'` (identifiers only)

## Done when
- Repo tree = `src/lixto`, `tests/`, `migrations/001_core.sql`, `web/`, `docs/`, `tickets/74+`; all checks green.

## Not included
- README/docs rewrite (86); infra (84).
