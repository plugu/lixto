---
id: 118
status: todo
model: sonnet
depends_on: []
max_attempts: 4
files:
  - web/lib/email/digest-batch.ts
  - web/lib/email/digest-batch.test.ts
  - web/app/api/internal/email/digest/route.test.ts
---
## Goal
Every admin of a company receives the daily digest, exactly once per São Paulo day, and the digest route is tested.

## Context

Reviewer findings:
1. **Only one admin ever gets mail** — `digest-batch.ts:81` builds `dedupeKey = "daily_digest:<companyId>:<date>"`, so the second admin's `enqueue` collides with the partial unique index and returns `skipped:"duplicate"`. Key on the recipient too: `daily_digest:<companyId>:<email>:<date>`.
2. **The test can't catch it** — `digest-batch.test.ts:102` asserts both calls share the key and passes only because `enqueue` is mocked as a stub. Replace that mock with a small fake outbox that enforces `dedupe_key` uniqueness (a `Set`), so a colliding key surfaces as a missing enqueue.
3. **Wrong day near midnight** — `today()` uses UTC while users and the `30 8 * * *` schedule are `America/Sao_Paulo`; a run between 21:00 and 24:00 BRT keys tomorrow's date and a second digest goes out next morning. Build the key from the São Paulo civil date: `new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(now)`.
4. **Route untested** — `web/app/api/internal/email/digest/route.ts` has no test (the send route is covered in `sender.test.ts`). Add `route.test.ts` next to it, importing the handler directly with **relative** imports (vitest has no `@/` alias for route files — see how `sender.test.ts` exercises the send route): 401 without the internal header, 200 + counts with it, `companyId` passed through, malformed body tolerated.

Do not change the internal route's implementation unless a test proves a defect.

## Checks (run in order — cheapest first)
1. `cd web && npx next typegen && npm run lint`
2. `cd web && npx tsc --noEmit`
3. `cd web && npx vitest run lib/email/digest-batch.test.ts app/api/internal/email/digest/route.test.ts`
4. `cd web && npm test`

## Done when
- A company with two admins enqueues two digest rows through a uniqueness-enforcing fake outbox; a 22:00 BRT run keys the same civil date as the 08:30 BRT run that follows it; the digest route 401s without the token and returns counts with it.

## Not included
- Sender/worker changes (117), outbox internals (116).
