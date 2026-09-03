---
id: 112
status: todo
model: sonnet
depends_on: [108, 110]
max_attempts: 4
files:
  - web/lib/email/unsubscribe.ts
  - web/app/(app)/email/unsubscribe/route.ts
  - web/app/(app)/signup/actions.ts
  - web/app/(app)/company/users/actions.ts
  - web/lib/email/callsites.test.ts
---
## Goal
Real events enqueue real mail: signup queues `welcome`, inviting a user queues `invite`, and the digest footer link suppresses that address.

## Context

Ticket 108 provides `enqueue` and `suppress` from `@/lib/email/outbox`; ticket 110 defines the payload shapes. `APP_URL = process.env.LIXTO_APP_URL ?? "https://lixto.com.br"`.

1. **`web/lib/email/unsubscribe.ts`** (new, no deps beyond `node:crypto`): `unsubscribeToken(email)` = `createHmac("sha256", process.env.LIXTO_INTERNAL_TOKEN ?? "").update(email.trim().toLowerCase()).digest("base64url")`; `verifyUnsubscribeToken(email, token)` using `timingSafeEqual` on equal-length buffers (false when lengths differ); `buildUnsubscribeUrl(email)` = `${APP_URL}/email/unsubscribe?email=<encoded>&token=<token>`. Ticket 113 imports `buildUnsubscribeUrl` from here.
2. **`web/app/(app)/email/unsubscribe/route.ts`** — `GET`: read `email` + `token` from the URL; both required; on `verifyUnsubscribeToken` → `suppress(email, "unsubscribe")` and return a small pt-BR HTML page (200, `content-type: text/html; charset=utf-8`) confirming the address will no longer receive the daily digest; otherwise 400 with a neutral message and **no** suppression. `export const runtime = "nodejs"`, `dynamic = "force-dynamic"`.
3. **Signup** — `web/app/(app)/signup/actions.ts` calls `createCompanyWithAdmin({...})` (~line 174); `SignupResult` in `web/lib/signup-queries.ts` has the created ids. After success, `enqueue({ toEmail: email, template: "welcome", payload: { userName: name, companyName: tradeName || legalName, appUrl: `${APP_URL}/lixto` }, companyId, userId })`, wrapped in try/catch with a `console.error` — a mail failure must never fail signup.
4. **Invite** — `web/app/(app)/company/users/actions.ts` `createInviteAction` already does `const { token } = await createInvite(session.company.id, {...})` and returns `{ token }`. After it, `enqueue({ toEmail: email, template: "invite", payload: { inviterName: session.user.name, companyName: session.company.trade_name ?? session.company.legal_name, acceptUrl: `${APP_URL}/invite/${token}`, expiresAt: <invite expiry ISO — read it back from `getInvite(token)` or the value `createInvite` returns> }, companyId: session.company.id })`, same try/catch rule; keep returning `{ token }` so the existing copy-link UI is unchanged.

Tests (`callsites.test.ts`): `vi.mock("@/lib/email/outbox")`. Pure-unit parts first — `unsubscribeToken` round-trips, a tampered token and a length-mismatched token both fail. For the two server actions, mock the session/query modules the way `web/lib/agent/tools.test.ts` mocks its deps and assert `enqueue` was called with the right template/payload, and that a rejecting `enqueue` still yields the action's normal return. If importing a server action under vitest proves impractical, extract the payload construction into an exported helper in the same actions file and test that — state the choice in the report.

## Checks (run in order — cheapest first)
1. `cd web && npm run lint`
2. `cd web && npx tsc --noEmit`
3. `cd web && npx vitest run lib/email/callsites.test.ts`
4. `cd web && npm test`
5. `cd web && npm run build`

## Done when
- Signup enqueues one `welcome`; creating an invite enqueues one `invite` whose `acceptUrl` carries the raw token and still returns `{ token }`; `GET /email/unsubscribe` suppresses on a valid token and does nothing on a tampered one.

## Not included
- Password-reset flow/UI (template exists; the flow is a later cycle), digest enqueue (ticket 113), sending (111).
