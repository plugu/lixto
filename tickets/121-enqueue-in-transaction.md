---
id: 121
status: done
model: sonnet
depends_on: [116]
max_attempts: 4
files:
  - web/lib/signup-queries.ts
  - web/lib/user-queries.ts
  - web/app/(app)/signup/actions.ts
  - web/app/(app)/company/users/actions.ts
  - web/lib/email/callsites.test.ts
---
## Goal
Welcome and invite mail are enqueued inside the same transaction as the row that justifies them — the guarantee PRODUCT §1 and ADR D1 claim but the code does not implement.

## Context

Reviewer finding: `signup/actions.ts:247` and `company/users/actions.ts:75` enqueue **after** the business transaction has committed, on the default `pool`, with failures swallowed into `console.error`. `enqueue(input, client)` accepts a client but no production call site passes one, so a crash between COMMIT and enqueue silently loses the mail — exactly the failure the outbox exists to prevent. Ticket 116 also makes `enqueue` a single atomic statement; that does not change this.

Change:
1. `web/lib/signup-queries.ts` — `createCompanyWithAdmin` already opens a client and runs a transaction. Give it an optional `onCommitted?: (ctx: { client: Queryable; companyId: number; userId: number }) => Promise<void>` hook invoked **inside** the transaction, after the inserts and before `COMMIT`. Keep the current return shape.
2. `web/lib/user-queries.ts` — same shape for `createInvite`: an optional hook receiving `{ client, userId, token, expiresAt }` before COMMIT. This also removes the local `Date.now() + 7 days` guess in the action (reviewer note) — expose the real `invite_expires_at`.
3. Both actions pass the hook and call `enqueue(input, ctx.client)`. A throwing `enqueue` now rolls back the signup/invite — that is the intended trade (the user retries) — but keep the enqueue payload construction outside the transaction so only the INSERT is inside it.
4. Existing behaviour to preserve: `createInviteAction` still returns `{ token }`; signup still redirects as before.

Update `web/lib/email/callsites.test.ts`: assert `enqueue` is called with the transaction's client (the hook's `ctx.client`, not the pool), that the invite payload's `expiresAt` comes from the DB row rather than a local computation, and that a rejecting `enqueue` propagates (transaction rolled back) instead of being swallowed.

## Checks (run in order — cheapest first)
1. `cd web && npx next typegen && npm run lint`
2. `cd web && npx tsc --noEmit`
3. `cd web && npx vitest run lib/email/callsites.test.ts`
4. `cd web && npm test`
5. `cd web && npm run build`

## Done when
- Both call sites enqueue through the transaction client before COMMIT, the invite's `expiresAt` is the persisted value, and a failing enqueue rolls the business insert back instead of leaving a user with no mail.

## Not included
- Password-reset flow (deferred — see PRODUCT), retry semantics (116/117).
