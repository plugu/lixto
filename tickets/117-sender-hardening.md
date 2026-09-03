---
id: 117
status: doing
model: sonnet
depends_on: [115, 116]
max_attempts: 4
files:
  - web/lib/email/sender.ts
  - web/lib/email/sender.test.ts
---
## Goal
The worker sweeps stale rows, never delivers to a suppressed address, records the subject, and emits one-click-compliant unsubscribe headers.

## Context

Ticket 116 adds to `@/lib/email/outbox`: `requeueStale({ olderThanMinutes, client? })`, an atomic `enqueue`, `markSent(id, messageId, subject?, client?)` and `sending` in `emailStats` — use the signatures exactly as merged (read the file). Ticket 115 adds a `POST` handler on `/email/unsubscribe`.

Changes in `sender.ts`:
1. `runEmailWorker` calls `requeueStale()` before `claimBatch`, and reports the recovered count in its result (`{ claimed, sent, failed, suppressed, requeued }`).
2. `sendOne` re-checks `isSuppressed(row.to_email)` immediately before `transport.sendMail`; when true, skip the send and settle the row as `suppressed` (do not count it as sent). Closes the enqueue→unsubscribe→send race that survives even the atomic insert.
3. Pass the rendered subject into `markSent`.
4. Unsubscribe headers on `daily_digest` only: `List-Unsubscribe: <url>` **plus** `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (Gmail/Yahoo bulk rules require the pair; the URL must be the POST-capable route from ticket 115).
5. `web/lib/br-validators.ts` accepts `a@b.com,c.d`, which nodemailer would expand into two recipients — reject any address containing `,` or `;` in `sendOne` before sending (settle as `failed`, non-retryable) rather than editing the shared validator.

Extend `sender.test.ts`: worker calls `requeueStale` first and surfaces the count; a row whose address became suppressed after claim is not sent and settles `suppressed`; `markSent` receives the subject; both List-Unsubscribe headers appear for `daily_digest` and neither for `welcome`; a comma address fails non-retryably.

## Checks (run in order — cheapest first)
1. `cd web && npx next typegen && npm run lint`
2. `cd web && npx tsc --noEmit`
3. `cd web && npx vitest run lib/email/sender.test.ts`
4. `cd web && npm test`
5. `cd web && npm run build`

## Done when
- A stale `sending` row is recovered and delivered on the next pass; an address suppressed between enqueue and send is never mailed; digest mail carries both unsubscribe headers.

## Not included
- Outbox internals (116), the route/proxy (115), bounce ingestion (120).
