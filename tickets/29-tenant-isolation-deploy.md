---
id: 29
status: doing
model: haiku
depends_on: [25, 26, 27, 28]
max_attempts: 3
files:
  - web/lib/tenant-isolation.test.ts
  - web/Dockerfile
  - docker-compose.yml
  - docs/WEB_STYLE.md
  - docs/TENANT.md
  - README.md
---
## Goal
One test file proves every tenant query builder binds `empresa_id`; uploads volume is wired for Docker/Dokploy; docs describe the tenant model.

## Context
Builders exported by tickets 25–28: `@/lib/empresa-queries` (`buildUpdateEmpresa`, `buildInsertCnaes`), `@/lib/usuario-queries` (`buildListUsuarios`, `buildUpdateRole`, `buildRemoveUsuario`), `@/lib/documento-queries` (`buildListDocumentos`, `buildGetDocumento`, `buildDeleteDocumento`, `buildInsertDocumento`). Each returns `{ text, values }`. `web/Dockerfile` exists from ticket 17 (non-root, standalone). `UPLOADS_DIR` env read by `web/lib/uploads.ts`.

`web/lib/tenant-isolation.test.ts`: table-driven vitest — for each builder above, call with `empresaId = 42` (+ minimal other args) and assert `/empresa_id\s*=\s*\$\d/.test(text)` and `values.includes(42)`. One extra test: `buildGetDocumento(42, 7)` text contains both `id = $` and `empresa_id = $`.

`web/Dockerfile`: add `RUN mkdir -p /app/uploads && chown <nonroot-user> /app/uploads` before switching user; `ENV UPLOADS_DIR=/app/uploads`; `VOLUME ["/app/uploads"]`. Do not change anything else.

`docker-compose.yml`: add top-level comment block (no new service) noting local dev uses `./web/uploads` (gitignored — add `web/uploads/` to `.gitignore` only if `.gitignore` lacks it; `.gitignore` is allowed as an implicit extra file for this single line).

`docs/TENANT.md` (≤60 lines): tables + relationships, roles, session mechanics (cookie `plic_session`, `sessao` table, 30 d), invite flow, upload storage + Dokploy volume mount instruction (`/app/uploads` → named volume `plataforma-licitante-uploads`), rule "empresa_id only from session", list of public routes in `proxy.ts`.

`docs/WEB_STYLE.md`: append section "Formulários" — label `text-xs font-medium text-muted-foreground`, input control classes, form card spacing `space-y-6`, inline error `text-sm text-unclear`, success `text-sm text-met`.

`README.md`: add "Multi-tenant (cycle 7)" paragraph with link to `docs/TENANT.md` and env vars `UPLOADS_DIR`, `PLIC_DATABASE_URL`.

## Checks (run in order — cheapest first)
1. `cd web && npx tsc --noEmit && npm run lint`
2. `cd web && npx vitest run`
3. `cd web && npm run build`
4. `docker build -t plic-web-test web/ && docker run --rm plic-web-test sh -c 'test -d /app/uploads && id -u | grep -qv "^0$"'`

## Done when
- Full vitest suite green; Docker image builds with writable `/app/uploads` as non-root; docs present.

## Not included
- No Dokploy API calls (operator mounts the volume manually per `docs/TENANT.md`), no new features, no refactors of earlier tickets' code.
