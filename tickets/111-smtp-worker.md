---
id: 111
status: todo
model: opus
depends_on: [108, 110]
max_attempts: 4
files:
  - web/lib/email/sender.ts
  - web/lib/email/sender.test.ts
  - web/app/api/internal/email/send/route.ts
  - web/package.json
  - web/package-lock.json
---
## Goal
A worker drains the outbox through the local MTA: renders, sends over SMTP, records the Message-ID, retries the retryable and suppresses hard bounces.

## Context

Ticket 108 provides `web/lib/email/outbox.ts` (`claimBatch`, `markSent`, `markFailed`, `suppress`, `enqueue`); ticket 110 provides `renderTemplate`. Internal endpoints follow `web/app/api/internal/match/run/route.ts`: `isInternalRequest(request)` guard from `@/lib/internal-auth`, `runtime = "nodejs"`, `dynamic = "force-dynamic"`, `maxDuration = 300`, JSON body optional.

Add `nodemailer` (+ `@types/nodemailer` dev) via `npm i` in `web/`.

`sender.ts`:
- `getTransport()` — `nodemailer.createTransport({ host: LIXTO_SMTP_HOST ?? "lixto-mail", port: Number(LIXTO_SMTP_PORT ?? 25), secure: false, ignoreTLS: true, pool: true, maxConnections: 1, maxMessages: 50 })`. Built per call (no key at build time); host/port are the in-network MTA from ticket 109.
- `EMAIL_FROM = process.env.LIXTO_EMAIL_FROM ?? "Lixto <nao-responda@lixto.com.br>"`, `EMAIL_REPLY_TO = process.env.LIXTO_EMAIL_REPLY_TO` (optional).
- `sendOne(row, deps?)` — renders via `renderTemplate(row.template, row.payload)`, sends `{ from, to, subject, html, text, replyTo?, headers: { "List-Unsubscribe": … } }` (only for `daily_digest`, using `payload.unsubscribeUrl`), then `markSent(row.id, info.messageId)`.
- `classifyError(err)` → `{ retryable }`: SMTP 5xx and nodemailer `responseCode >= 500` (plus `EENVELOPE`, invalid recipient) are permanent → `markFailed(..., { retryable: false })`, and 5.1.1 / "user unknown" / "mailbox unavailable" also calls `suppress(to, "hard_bounce", detail)`. 4xx, connection refused/timeout (`ECONNREFUSED`, `ETIMEDOUT`, `EAI_AGAIN`) are transient → retryable.
- `runEmailWorker({ limit = 20, deps? })` → `{ claimed, sent, failed, suppressed }`; claims a batch, sends sequentially (Postfix is rate-limited at ~4 msg/min — never parallelise), catches per row so one bad address can't abort the run.
- Missing transport config or a connection failure must never throw out of the route: it returns counts with `failed` and the rows go back to `queued` with backoff.

`route.ts` — `POST /api/internal/email/send`: internal-token guard, optional `{ limit }`, calls `runEmailWorker`, returns the counts as JSON, 401 on a bad token.

Tests (mock nodemailer transport + the outbox module): a queued row is rendered and sent, `markSent` gets the transport's `messageId`; a 550 "user unknown" marks failed non-retryable **and** suppresses the address; `ECONNREFUSED` marks failed retryable; `List-Unsubscribe` present only for `daily_digest`; the worker keeps going after one row throws; a 401 when `isInternalRequest` is false.

## Checks (run in order — cheapest first)
1. `cd web && npm run lint`
2. `cd web && npx tsc --noEmit`
3. `cd web && npx vitest run lib/email/sender.test.ts`
4. `cd web && npm test`
5. `cd web && npm run build`

## Done when
- `runEmailWorker` sends a claimed row through a mocked transport and records the Message-ID; a hard bounce suppresses the address while a connection error leaves the row retryable; `POST /api/internal/email/send` returns counts and 401s without the token.

## Not included
- Enqueue call sites (ticket 112), CLI + schedules (113), MTA container (109).
