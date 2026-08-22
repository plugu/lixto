---
mode: mvp
routing_profile: cloud
parallel_default: sequential
worktree: required
---

# plataforma-licitante — multi-tenant empresa / usuário (cycle 7)

## What / why

The site is public and single-profile: fit-triage reads one `company_profile.md`. To serve more than one bidder it needs tenants. This cycle adds the two-level model **empresa → usuários**, email+password auth, and a document locker per empresa — modelled exclusively on Brazilian legal/market fields so later cycles can feed agents and habilitação checks from real company data. All work happens in a git worktree off `main`.

## Primary user story

As a bidder, I sign up with my CNPJ; the form autofills razão social, natureza jurídica, porte, endereço and CNAEs from BrasilAPI (manual fallback if it fails); I become the empresa's `admin`, invite colleagues by email as `member`, upload our habilitação documents with validity dates, and every page from then on requires login and shows only my empresa's data.

## Scope

- **Empresa:** CNPJ (validated check digits, unique), razão social, nome fantasia, natureza jurídica, porte (`MEI|ME|EPP|MEDIO|GRANDE`), optante Simples flag, inscrição estadual/municipal, endereço (CEP, logradouro, número, complemento, bairro, município, UF), telefone, email. `empresa_cnae` table: código, descrição, `principal` flag.
- **Usuário:** nome, email (unique, login), senha hash, CPF (optional, validated), telefone, cargo, `role` (`admin|member`), `empresa_id`. Signup creates empresa + first admin atomically. Admin: edit empresa, manage users/docs, invite by email (invite token, set password on accept). Member: read-only.
- **Documentos:** fixed `tipo` list — contrato social, cartão CNPJ, certidão federal/FGTS/trabalhista/estadual/municipal, balanço patrimonial, atestado capacidade técnica, outros. Fields: arquivo, validade (optional), `vencido` derived. Files on local volume `UPLOADS_DIR`, metadata in Postgres; PDF/JPG/PNG, ≤20 MB; download only by same-empresa users.
- **Auth:** session cookie, middleware guards all routes except login/signup/invite-accept. Tenant scoping enforced in queries (`empresa_id` from session, never from request).
- **Migration `007_tenant.sql`;** pages: `/signup`, `/login`, `/empresa` (profile + CNAEs), `/empresa/usuarios`, `/empresa/documentos`.
- **Tests:** CNPJ/CPF validators, tenant-scoping of queries, role checks, signup transaction.

## Out of scope

- Licitações remain a shared feed; no per-empresa favorites or filters.
- Agents/fit-triage still read `company_profile.md`; wiring to empresa record = next cycle.
- OAuth, magic link, 2FA, password-reset email flow (reset by admin-only manual path acceptable).
- S3/R2 storage; virus scanning; document OCR.
- Billing, plans, super-admin panel across tenants.
- Deploy changes beyond adding `UPLOADS_DIR` volume + env to existing Dokploy app.

## Success demo

Done when I can sign up with a real CNPJ and see it autofilled, invite a second user who logs in as member and cannot edit the empresa, upload a certidão with a past validity and see it flagged `vencido`, and confirm a user from a second empresa sees none of the first empresa's users or documents.
