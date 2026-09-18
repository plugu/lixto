---
id: 157
status: done
model: opus
depends_on: [153]
max_attempts: 4
files:
  - web/lib/auth.ts
  - web/lib/auth.test.ts
  - web/lib/types.ts
  - web/app/(app)/login/actions.ts
  - web/app/(app)/login/page.tsx
---
## Goal
Only users of an approved company get a session: login refuses pending/rejected companies with a specific message, `getSession` ignores sessions of non-approved companies, and `Session` carries `isSuperadmin` with a `requireSuperadmin()` gate that 404s.

## Context
`web/lib/auth.ts`: `SESSION_SELECT` joins `users u` and `companies c`; `toSession` maps rows; `getSession` reads the cookie; `login(email, password)` verifies scrypt then creates the session and returns `Session | null`. `web/app/(app)/login/actions.ts` redirects to `/login?error=1` on null; `login/page.tsx` renders one alert for `error=1`. Migration 007 added `companies.approval_status` and `users.is_superadmin`. `web/lib/types.ts` exports `Role`.

Work:
1. `types.ts`: `export type ApprovalStatus = "pending" | "approved" | "rejected";` and `export const APPROVAL_STATUSES = ["pending","approved","rejected"] as const`.
2. `auth.ts`: `SessionUser` gains `isSuperadmin: boolean`; `SessionRow` gains `is_superadmin: boolean` and `approval_status: ApprovalStatus`; `SESSION_SELECT` selects `u.is_superadmin, c.approval_status`. `getSession` adds `AND c.approval_status = 'approved'` to its WHERE. Add `export async function requireSuperadmin(): Promise<Session>` = `requireSession()` then `notFound()` (from `next/navigation`) when `!session.user.isSuperadmin`.
3. `login` returns `LoginResult = { status: "ok"; session: Session } | { status: "invalid" | "pending" | "rejected" }`. Query `SELECT u.id, u.password_hash, c.approval_status FROM users u JOIN companies c ON c.id = u.company_id WHERE u.email = $1`; verify the password **before** looking at the status (wrong password on a pending account must still say `invalid`, never leak state); when `approval_status !== 'approved'` return that status without creating a session. Export a pure `classifyLogin(passwordOk: boolean, status: ApprovalStatus): LoginResult["status"]` used by `login` and unit-tested in `auth.test.ts` (all six combinations).
4. `login/actions.ts`: on non-ok, redirect to `/login?error=<status>` (`invalid|pending|rejected`), preserving `next`.
5. `login/page.tsx`: map `error` to copy — `invalid`: "E-mail ou senha inválidos." (also for the legacy `1`); `pending`: "Sua conta ainda está em análise. Avisaremos por e-mail quando o acesso for liberado."; `rejected`: "O cadastro da sua empresa não foi aprovado. Responda ao e-mail que enviamos se tiver dúvidas." Same `role="alert"` box.

No other call sites of `login()` exist; `createSession` callers (invite accept) are untouched.

## Checks (run in order — cheapest first)
1. `cd web && npm run lint`
2. `cd web && npx vitest run lib/auth.test.ts`
3. `cd web && npm run build`
4. `cd web && curl -s -o /dev/null -w '%{http_code}' -b lixto_session=devprobe localhost:3000/dashboard | grep -qx 200 && curl -s 'localhost:3000/login?error=pending' | grep -q 'em análise'`

## Done when
- With the dev DB: `UPDATE companies SET approval_status='pending' WHERE id=1` makes `curl -b lixto_session=devprobe localhost:3000/dashboard` redirect to `/login` (307) and the login form for that user shows the pending message; setting it back to `approved` restores access. Wrong password on a pending account shows the invalid message.

## Not included
- Sidebar/nav changes (159); the admin page (158); rate limiting.
