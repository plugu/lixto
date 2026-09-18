---
id: 156
status: todo
model: sonnet
depends_on: [155]
max_attempts: 4
files:
  - web/app/(app)/signup/actions.ts
  - web/app/(app)/signup/recebido/page.tsx
  - web/lib/superadmin-queries.ts
  - web/lib/superadmin-queries.test.ts
  - web/lib/email/callsites.test.ts
---
## Goal
Signup creates a pending company with no session, lands on "Cadastro recebido", and enqueues `signup_received` to the applicant plus `signup_pending_admin` to every superadmin in the same transaction.

## Context
`web/app/(app)/signup/actions.ts:signupAction` calls `createCompanyWithAdmin(input, onCommitted)` (`web/lib/signup-queries.ts`); the hook runs inside the transaction with `{ client, companyId, userId }` and currently enqueues `welcome`; after the try/catch it calls `createSession` + `setSessionCookie` and `redirect("/company")`. The company row now defaults to `approval_status='pending'` (migration 007), so `signup-queries.ts` needs no change. `enqueue(input, client)` is in `web/lib/email/outbox.ts`. `APP_URL` constant already exists in the action.

Work:
1. `web/lib/superadmin-queries.ts`: `buildListSuperadminRecipients(): SqlQuery` → `SELECT id, email, name FROM users WHERE is_superadmin ORDER BY id` and `listSuperadminRecipients(client: Queryable = pool)` (pg bigints → `Number`). Unit-test the builder's SQL in `superadmin-queries.test.ts` (relative imports, like `user-queries.test.ts`).
2. `signup/actions.ts`: replace `buildWelcomeEmailInput` with `buildSignupReceivedInput` (`signup_received`, payload `{ userName, companyName }`, `companyId`, `userId`) and `buildPendingAdminInput(recipient, {...})` (`signup_pending_admin`, payload `{ companyName, taxId (digits), adminName, adminEmail, adminUrl: `${APP_URL}/admin/companies` }`, `companyId`, `userId: recipient.id`). Keep both `async` (file is `"use server"`). In the hook: enqueue the received mail, then `listSuperadminRecipients(client)` and enqueue one pending-admin mail per recipient. Remove `createSession`/`setSessionCookie` imports and calls; end with `redirect("/signup/recebido")`.
3. `web/app/(app)/signup/recebido/page.tsx`: server page, same centered layout as `login/page.tsx` (Logo link, `font-display` h1 "Cadastro recebido", one paragraph "Estamos avaliando os dados da sua empresa. Você receberá um e-mail assim que o acesso for liberado.", `LinkButton` ghost → `/`). `export const metadata = { title: "Cadastro recebido — Lixto" }`.
4. `callsites.test.ts` `describe("signupAction")`: mock `@/lib/superadmin-queries` (`listSuperadminRecipients: vi.fn()`); assert `signup_received` is enqueued through the transaction client with the created ids, that with two superadmin recipients two `signup_pending_admin` mails are enqueued (to their emails, `userId` = recipient id), that `createSession`/`setSessionCookie` are never called, that the redirect target is `/signup/recebido`, and keep the "rejecting enqueue rolls back" case.

## Checks (run in order — cheapest first)
1. `cd web && npm run lint`
2. `cd web && npx vitest run lib/email/callsites.test.ts lib/superadmin-queries.test.ts`
3. `cd web && npm run build`
4. `cd web && curl -s -o /dev/null -w '%{http_code}' localhost:3000/signup/recebido | grep -qx 200`

## Done when
- Submitting the signup form on :3000 with a fresh CNPJ/email ends on `/signup/recebido` with no `lixto_session` cookie; `SELECT template, to_email FROM email_messages ORDER BY id DESC LIMIT 3` shows `signup_received` plus one `signup_pending_admin` per superadmin; the new company row has `approval_status='pending'`.

## Not included
- Login behaviour for pending users (157); the admin page the `adminUrl` points to (158); the `welcome` template stays defined but unused.
