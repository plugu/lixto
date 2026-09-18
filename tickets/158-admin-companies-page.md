---
id: 158
status: todo
model: sonnet
depends_on: [155, 157]
max_attempts: 4
files:
  - web/lib/company-approval-queries.ts
  - web/lib/company-approval-queries.test.ts
  - web/app/(app)/admin/companies/page.tsx
  - web/app/(app)/admin/companies/actions.ts
  - web/components/admin/companies-table.tsx
---
## Goal
`/admin/companies` lists companies by approval status with Pendentes / Aprovadas / Rejeitadas tabs and lets a superadmin approve or reject (optional reason), enqueuing the status email in the same transaction.

## Context
Gate: `requireSuperadmin()` from `web/lib/auth.ts` (404 for everyone else). Page shape to copy: `web/app/(app)/company/users/page.tsx` (`Section`, `Table` primitives from `components/ui/table.tsx`, `Badge` tones from `components/ui/badge.tsx`). Tabs: `PillTabs` (`components/ui/pill-tabs.tsx`, `param="status"`, default `pending`, `clearOnDefault`), server page reads `searchParams.status` and validates against `APPROVAL_STATUSES` (`lib/types.ts`). Client table + server actions pattern: `components/users-table.tsx` + `app/(app)/company/users/actions.ts`. Outbox: `enqueue(input, client)` in `lib/email/outbox.ts` with templates from 155; `APP_URL` = `process.env.LIXTO_APP_URL ?? "https://lixto.com.br"`.

Work:
1. `lib/company-approval-queries.ts` (relative imports; builders unit-tested in the `.test.ts`):
   - `buildListCompaniesByStatus(status)`: company id, tax_id, legal_name, trade_name, city_name, state, created_at, approval_reason, approval_changed_at, plus the first admin (`users` with `role='admin'` lowest id: name, email) via LEFT JOIN LATERAL; ORDER BY created_at DESC; `listCompaniesByStatus(status)` maps bigints/dates.
   - `buildSetApprovalStatus(companyId, status, reason, changedByUserId)`: `UPDATE companies SET approval_status=$2, approval_reason=$3, approval_changed_at=now(), approval_changed_by=$4, updated_at=now() WHERE id=$1 RETURNING legal_name, trade_name`.
   - `setApprovalStatus(companyId, status, reason, changedBy)`: transaction — run the update, load the first admin (name, email, id), enqueue `signup_approved` (`{ userName, companyName, loginUrl: `${APP_URL}/login` }`) or `signup_rejected` (`{ userName, companyName, reason }`) with `companyId`, `userId`, then COMMIT; ROLLBACK on error. Idempotent: setting the same status again still sends the mail (superadmin may resend on purpose) — document that in a comment.
   - `countPendingCompanies()` for the tab badge.
2. `admin/companies/actions.ts` (`"use server"`): `approveCompanyAction(formData)` and `rejectCompanyAction(formData)` — `requireSuperadmin()`, parse `companyId` (positive int) and `reason` (trimmed, ≤500 chars, empty → null), call `setApprovalStatus`, `revalidatePath("/admin/companies")`.
3. `admin/companies/page.tsx`: `requireSuperadmin()`; `Section eyebrow="Administração" title="Empresas"`; `PillTabs` with labels `Pendentes (n)` / `Aprovadas` / `Rejeitadas`; `CompaniesTable rows={...} status={...}`; empty state text per tab. `export const dynamic = "force-dynamic"` like other app pages.
4. `components/admin/companies-table.tsx` (`"use client"`): columns Empresa (legal_name + trade_name muted), CNPJ formatted `00.000.000/0000-00`, Cidade/UF, Admin (name + email), Cadastro (date `pt-BR`), Situação (`Badge`: pending→`warn`, approved→`ok`, rejected→`off`, with reason as `title`), Ações: on pending → `Aprovar` (primary sm) and `Rejeitar` (ghost sm, opens an inline `<details>` with a `reason` textarea + confirm); on approved → `Rejeitar` (revoke); on rejected → `Aprovar`. Forms post to the two actions; pending state via `useFormStatus` disables the buttons. Use `sonner` `toast` for success/error like `users-table.tsx` if it does, otherwise plain form submit.

## Checks (run in order — cheapest first)
1. `cd web && npm run lint`
2. `cd web && npx vitest run lib/company-approval-queries.test.ts`
3. `cd web && npm run build`
4. `cd web && docker compose -f /Users/aazevedo/dev/plataforma-licitante/docker-compose.yml exec -T db psql -U lixto -d lixto -Atc "UPDATE users SET is_superadmin=false WHERE id=(SELECT user_id FROM sessions WHERE token_hash=encode(sha256('devprobe'::bytea),'hex'))" >/dev/null && curl -s -o /dev/null -w '%{http_code}' -b lixto_session=devprobe localhost:3000/admin/companies | grep -qx 404 && docker compose -f /Users/aazevedo/dev/plataforma-licitante/docker-compose.yml exec -T db psql -U lixto -d lixto -Atc "UPDATE users SET is_superadmin=true WHERE id=(SELECT user_id FROM sessions WHERE token_hash=encode(sha256('devprobe'::bytea),'hex'))" >/dev/null && curl -s -b lixto_session=devprobe localhost:3000/admin/companies | grep -q 'Pendentes'`

## Done when
- As a superadmin on :3000, a pending company shows under Pendentes; clicking Aprovar moves it to Aprovadas, writes `approval_changed_by/at`, and `email_messages` gains a `signup_approved` row for its admin; Rejeitar with a reason stores `approval_reason` and enqueues `signup_rejected` with that reason.

## Not included
- Sidebar/⌘K entries (159); editing company data; audit history beyond the last change; pagination (fewer than a few hundred companies expected).
