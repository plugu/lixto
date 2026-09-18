---
id: 161
status: done
model: sonnet
depends_on: [160]
max_attempts: 4
files:
  - web/app/(app)/admin/layout.tsx
  - web/app/(app)/admin/companies/actions.ts
  - web/app/(app)/admin/companies/actions.test.ts
  - web/lib/company-approval-queries.ts
  - web/lib/company-approval-queries.test.ts
  - web/lib/auth.ts
  - web/lib/auth.test.ts
  - web/lib/user-queries.ts
  - web/app/(app)/invite/[token]/actions.ts
  - web/app/(app)/signup/actions.ts
  - web/lib/email/callsites.test.ts
  - web/lib/email/templates.ts
  - web/components/admin/companies-table.tsx
  - migrations/007_company_approval.sql
---
## Goal
Close the reviewer's pre-ship findings for cycle 28: test the superadmin gate and the approve/reject transaction, guard `/admin/*` at the layout, and fix the small correctness/a11y items.

## Context
Reviewer pass over e7f8206..91f6417 (production mode, single round). Suites are green today (`npm test` 737, `pytest` 504); keep them green and add the tests below. Mocking pattern for server actions: `web/lib/email/callsites.test.ts` (`vi.mock("@/lib/auth", ...)`, `next/navigation` redirect that throws). Transaction test pattern: `web/lib/signup-queries.test.ts` (stub `pool.connect()` client). `formatCNPJ` exists in `web/lib/br-validators.ts:62`.

Work (numbers = reviewer findings):
1. **(F5)** `web/app/(app)/admin/layout.tsx`: `export default async function AdminLayout({ children })` that `await requireSuperadmin()` then renders `children`. Keep the page's own `requireSuperadmin()` (defence in depth).
2. **(F1)** `admin/companies/actions.test.ts`: mock `@/lib/auth` (`requireSuperadmin`), `@/lib/company-approval-queries` (`setApprovalStatus`), `next/cache` (`revalidatePath`). Assert: when `requireSuperadmin` throws, `setApprovalStatus` is never called; happy-path arg mapping for approve and reject (companyId number, reason trimmed / `null` when empty, `changedBy` = session user id); invalid `companyId` and a 501-char reason throw (see 4) without calling `setApprovalStatus`.
3. **(F2, F16)** `company-approval-queries.ts` `setApprovalStatus`: wrap `ROLLBACK` in its own try/catch and call `client.release(err)` on failure so a poisoned connection is not returned to the pool; add tests with a stub client: BEGIN → UPDATE → `enqueue` receives the **tx client** → COMMIT order; a throwing `enqueue` yields ROLLBACK + `release(err)` + rethrow.
4. **(F8, F14)** `actions.ts`: invalid `companyId` or reason > 500 chars → `throw new Error("Motivo muito longo (máx. 500 caracteres).")` / `throw new Error("Empresa inválida.")` instead of a silent no-op; fix the comment citing "ADR 003 §D6" → §D2/§D3.
5. **(F3)** `auth.ts`: export `buildSessionByTokenQuery(): { text; values }`-style builder (or export `SESSION_BY_TOKEN_SQL`) used by `getSession`; `auth.test.ts` asserts it contains both `approval_status = 'approved'` and `expires_at > now()`.
6. **(F15)** `auth.ts` `login`: on unknown email or NULL `password_hash`, still run `verifyPassword` against a module-level dummy scrypt hash (generated once at import with `hashPassword("")`-equivalent constant string) so the miss path costs the same as a hit; comment why.
7. **(F4)** `user-queries.ts` `acceptInvite`: return `{ userId, approvalStatus }` by joining `companies` in `buildAcceptInvite`'s RETURNING (or a follow-up SELECT in the same function); `invite/[token]/actions.ts`: when `approvalStatus !== "approved"`, skip `createSession`/`setSessionCookie` and `redirect("/login?error=" + status)`.
8. **(F6)** `signup/actions.ts` `buildPendingAdminInput`: `companyId: null` (the applicant company is already in the payload); update the assertion in `callsites.test.ts`.
9. **(F13)** `templates.ts`: replace the local `formatCnpj` with `formatCNPJ` from `./../br-validators` (relative import, same convention as other lib files) and delete the copy; templates tests must still pass.
10. **(F11)** `companies-table.tsx`: `aria-label="Motivo da rejeição (opcional)"` on the reason textarea.
11. **(F10)** `migrations/007_company_approval.sql`: `DROP CONSTRAINT IF EXISTS email_messages_template_check`. (Already applied on dev; prod not yet — file edit is safe, `schema_migrations` tracks by filename.)
12. **(F17)** `auth.ts` `requireSuperadmin` comment: soften "route's existence is not revealed" (the href ships in the client bundle); 404 is about not redirecting/leaking session state.

## Checks (run in order — cheapest first)
1. `cd web && npm run lint`
2. `cd web && npx vitest run lib/auth.test.ts lib/company-approval-queries.test.ts lib/email/callsites.test.ts lib/email/templates.test.ts 'app/(app)/admin/companies/actions.test.ts'`
3. `cd web && npx tsc --noEmit && npm run build`
4. `cd web && npm test`
5. `cd web && docker compose -f /Users/aazevedo/dev/plataforma-licitante/docker-compose.yml exec -T db psql -U lixto -d lixto -Atc "UPDATE users SET is_superadmin=false WHERE id=1" >/dev/null && curl -s -o /dev/null -w '%{http_code}' -b lixto_session=devprobe localhost:3000/admin/companies | grep -qx 404 && docker compose -f /Users/aazevedo/dev/plataforma-licitante/docker-compose.yml exec -T db psql -U lixto -d lixto -Atc "UPDATE users SET is_superadmin=true WHERE id=1" >/dev/null && curl -s -b lixto_session=devprobe localhost:3000/admin/companies | grep -q Pendentes`

## Done when
- All five checks green; new tests cover gate-before-action, transaction order/rollback, and the `getSession` approval predicate.

## Not included
- Pagination, `welcome` template removal, dialog primitive, CLI "already granted" (162).
