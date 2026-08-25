---
id: 83
status: done
model: haiku
depends_on: [79, 82]
max_attempts: 4
files:
  - .github/workflows/deploy.yml
  - Dockerfile.cli
  - web/app/layout.tsx
  - web/app/page.tsx
  - web/components/marketing/**
  - web/app/error.tsx
  - web/app/not-found.tsx
  - pyproject.toml
  - uv.lock
  - .env.example
---
## Goal
Every remaining configuration and brand string says Lixto: deploy workflow, Dockerfiles, package metadata, env names, page metadata.

## Context

Read `PRODUCT.md` (rename scope) and `docs/adr/001-lixto-data-model.md` D7. Mechanical pass; no logic changes.

- `.github/workflows/deploy.yml`: secrets `DOKPLOY_DEPLOY_WEBHOOK_WEB` / `DOKPLOY_DEPLOY_WEBHOOK_CLI` (operator sets them in ticket 84), comments and app names `lixto-web` / `lixto-cli`, watched paths unchanged.
- `Dockerfile.cli`: CMD `lixto db init && exec sleep infinity`; comment updated.
- `pyproject.toml`: remove the `plic` script only if ticket 85 already ran; otherwise leave (85 owns removal). Description "Lixto — AI agent for Brazilian public procurement".
- Web metadata: `<title>`/OG in `web/app/layout.tsx` & `page.tsx` → Lixto (marketing copy already says Lixto; fix any leftover "Licitante"/"plataforma-licitante"), `error.tsx`/`not-found.tsx` brand.
- Root `.env.example`: `LIXTO_DATABASE_URL`, `LIXTO_LLM_BASE_URL`, `LIXTO_LLM_API_KEY`, `LIXTO_LLM_MODEL_CHEAP|DOC|STRONG|FALLBACK|EMBED`, `LIXTO_CHAT_MODEL`, `UPLOADS_DIR`.

## Checks (run in order — cheapest first)
1. `! grep -rn "PLIC_" .github Dockerfile.cli web/Dockerfile web/app/layout.tsx .env.example`
2. `! grep -rni "plataforma-licitante\|Licitante</" web/app web/components/marketing .github Dockerfile.cli`
3. `cd web && npx tsc --noEmit && npm run build`

## Done when
- No `PLIC_`/`plataforma-licitante` in config or page chrome; build green.

## Not included
- Actual Dokploy/GitHub renames (84); deleting `src/plic` (85); README (86).
