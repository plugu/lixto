---
id: 80
status: doing
model: opus
depends_on: [74]
max_attempts: 4
files:
  - web/lib/db.ts
  - web/lib/auth.ts
  - web/lib/auth.test.ts
  - web/lib/types.ts
  - web/lib/company-queries.ts
  - web/lib/company-queries.test.ts
  - web/lib/user-queries.ts
  - web/lib/user-queries.test.ts
  - web/lib/document-queries.ts
  - web/lib/document-queries.test.ts
  - web/lib/signup-queries.ts
  - web/lib/signup-queries.test.ts
  - web/lib/tenant-isolation.test.ts
  - web/lib/uploads.ts
  - web/lib/tenant-types.ts
  - web/lib/empresa-queries.ts
  - web/lib/empresa-queries.test.ts
  - web/lib/usuario-queries.ts
  - web/lib/usuario-queries.test.ts
  - web/lib/documento-queries.ts
  - web/lib/documento-queries.test.ts
  - web/proxy.ts
  - web/app/(app)/layout.tsx
  - web/app/(app)/login/**
  - web/app/(app)/logout/**
  - web/app/(app)/signup/**
  - web/app/(app)/invite/**
  - web/app/(app)/convite/**
  - web/app/(app)/company/page.tsx
  - web/app/(app)/company/actions.ts
  - web/app/(app)/company/users/**
  - web/app/(app)/company/documents/**
  - web/app/(app)/empresa/page.tsx
  - web/app/(app)/empresa/actions.ts
  - web/app/(app)/empresa/usuarios/**
  - web/app/(app)/empresa/documentos/**
  - web/components/sidebar.tsx
  - web/components/ui/top-bar.tsx
  - web/components/company-form.tsx
  - web/components/empresa-form.tsx
  - web/components/cnae-editor.tsx
  - web/components/invite-form.tsx
  - web/components/convite-form.tsx
  - web/components/document-upload-form.tsx
  - web/components/documento-upload-form.tsx
  - web/components/company-documents-table.tsx
  - web/components/documentos-empresa-table.tsx
  - web/components/users-table.tsx
  - web/components/usuarios-table.tsx
  - web/components/signup-form.tsx
  - web/Dockerfile
  - web/.env.example
---
## Goal
The web app's tenant layer (auth, companies, users, documents, signup/login/invite) runs on the new `lixto` database with English identifiers and routes, keeping the exact same UX.

## Context

Read `PRODUCT.md`, `docs/adr/001-lixto-data-model.md` (D4 companies/users/sessions/company_documents, D7 names/routes), `docs/TENANT.md` (golden rule: company id only from the session), **`web/AGENTS.md`** (Next 16.3 — check `node_modules/next/dist/docs/`). This is a **port with rename**: same logic, same components, same copy (Portuguese UI text unchanged), new table/column names, English file/route/identifier names. Legacy files listed under `files:` with Portuguese names are to be **deleted** after their English replacement exists (use `git mv` where the content survives). Tests: vitest, mocked pool, relative imports in `lib/`.

### Rename map (files)
`tenant-types.ts`→`types.ts` (`Company`, `CompanyCnae`, `User`, `CompanyDocument`, `Role`, `CompanySize` `MEI|ME|EPP|MEDIUM|LARGE`, `DOCUMENT_KINDS` with the ADR `kind` values + Portuguese labels, `UF_LIST`), `empresa-queries`→`company-queries`, `usuario-queries`→`user-queries`, `documento-queries`→`document-queries`, `empresa-form`→`company-form`, `convite-form`→`invite-form`, `documento-upload-form`→`document-upload-form`, `documentos-empresa-table`→`company-documents-table`, `usuarios-table`→`users-table`. Routes: `/empresa`→`/company`, `/empresa/usuarios`→`/company/users`, `/empresa/documentos`→`/company/documents`, `/convite/[token]`→`/invite/[token]`. Keep `/login`, `/signup`, `/logout`, `/dashboard` paths (dashboard page itself is ticket 81 — only its nav link moves here).

### Rules
- `db.ts`: `LIXTO_DATABASE_URL`, default `postgresql://lixto:lixto@localhost:5433/lixto`.
- `auth.ts`: tables `users`/`sessions`/`companies`, cookie `lixto_session`, `Session = { user: {id, name, email, role, companyId}, company: {id, legalName, tradeName, taxId} }`; `requireSession`/`requireAdmin` unchanged in behaviour. `proxy.ts`: cookie name + `PUBLIC_PREFIXES` with `/invite`.
- Every query binds `companyId` from the session; `tenant-isolation.test.ts` ported to assert it.
- Sidebar: `NAV_ITEMS` `/lixto`, `/dashboard`, `/procurements` (labels PT: Lixto, Painel, Licitações); company items `/company` (Minha empresa), admin `/company/users`, `/company/documents`; the `/company/profile` tab entry (`Match`) is added by ticket 82 — leave a comment placeholder, don't add it.
- Brand string "Licitante" in sidebar/top-bar → "Lixto".
- `web/Dockerfile`: unchanged except `UPLOADS_DIR` stays; `web/.env.example` documents `LIXTO_DATABASE_URL`, `UPLOADS_DIR`.
- Legacy pages under `/licitacoes`, `/licitacao/[…]`, `/dashboard`, `/empresa/perfil`, `/lixto`, `/api/chat` and `web/lib/{queries,detail-queries,preco-queries,stats-queries,analise-queries,perfil-queries,match-*,enriquecimento-queries,agent/*}` are **not yours** — they will fail typecheck once `Session`/types change; make the minimal edits inside your own files only and, if `tsc` fails solely because those legacy modules reference renamed types, add the compat re-exports in `types.ts` (`export type Empresa = Company` etc.) and `auth.ts` (`session.usuario`/`session.empresa` getters) so the build stays green until 81/82 replace them. Remove the shims in 82.

## Checks (run in order — cheapest first)
1. `cd web && npx tsc --noEmit`
2. `cd web && npm run lint`
3. `cd web && npm test`
4. `cd web && npm run build`
5. Runtime probe (local `lixto` DB from ticket 74): `cd web && (npm run start -- -p 3101 &) && sleep 5`; `curl -s -o /dev/null -w '%{http_code}\n' localhost:3101/signup` → `200`; POST the signup form is interactive — instead insert a company+user directly: `docker compose exec -T db psql -U lixto -c "insert into companies (tax_id, legal_name) values ('00000000000191','Probe SA'); insert into users (company_id,email,password_hash,name,role) values (1,'probe@lixto.test','x','Probe','admin')"`, mint a session as in ticket 68 (table `sessions`, cookie `lixto_session`), then `curl -s -o /tmp/company.html -w '%{http_code}\n' -b "lixto_session=$token" localhost:3101/company` → `200` and `grep -q 'Minha empresa' /tmp/company.html`. `pkill -f next-server`.

## Done when
- Signup, login, invite, company profile, users and documents pages work against `lixto` tables at the English routes; no file under `web/lib`/`web/app`/`web/components` you own contains `empresa`, `usuario`, `documento` identifiers (UI copy excluded).

## Not included
- Procurement list/detail/dashboard (81), profile/match/chat (82), deploy config (83), deleting unrelated legacy files (85).
