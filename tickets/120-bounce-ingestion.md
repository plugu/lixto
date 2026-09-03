---
id: 120
status: doing
model: opus
depends_on: [116, 119]
max_attempts: 4
files:
  - infra/mail/main.cf
  - infra/mail/entrypoint.sh
  - web/lib/email/bounces.ts
  - web/lib/email/bounces.test.ts
  - web/app/api/internal/email/bounces/route.ts
  - src/lixto/cli/email.py
  - src/lixto/internal_api.py
  - tests/test_cli_email.py
---
## Goal
Asynchronous bounces come back into the system: a message that Gmail rejects after the local handshake ends `failed` and its address is suppressed.

## Context

**This is the gap that makes PRODUCT §3 and the success demo currently false.** Postfix accepts on the local hop and delivers direct-to-MX later, so `classifyError`/`HARD_BOUNCE_PHRASES` (`sender.ts:118`) only ever see the local handshake — a nonexistent recipient is recorded as `sent`. Worse, the DSN Postfix mails back to `nao-responda@lixto.com.br` hits the new `MX 10 mail` (`infra/terraform/dns.tf:24`) on a host with `mydestination =` and is rejected, so the bounce is lost entirely.

Design (keep it as small as possible):
1. **Receive our own DSNs.** In `infra/mail/main.cf`, accept mail for the bounce address only: a `virtual_alias_maps` (or `virtual_mailbox_maps`) entry delivering `bounces@lixto.com.br` (and `nao-responda@`) to a maildir under the DKIM volume, e.g. `/var/db/mail/bounces/`; set `LIXTO_BOUNCE_ADDRESS` and use it as the envelope sender / `Return-Path` so DSNs land there. Everything else stays rejected. Document why in the file header.
2. **Parse.** `web/lib/email/bounces.ts`: `parseDsn(raw: string)` → `{ recipient, status, diagnostic, originalMessageId }` from RFC 3464 `message/delivery-status` parts (`Final-Recipient`, `Status`, `Diagnostic-Code`, `Original-Message-ID` or the returned headers). `ingestBounces({ dir, deps? })` reads new files from the maildir, and for each: hard (`5.x.x`) → `markFailed(id, diagnostic, { retryable: false })` on the row matching `message_id` (fall back to the newest `sent` row for that recipient) **and** `suppress(recipient, "hard_bounce", diagnostic)`; soft (`4.x.x`) → log only; unparseable → move to a `failed/` subdir, never crash the batch. Returns `{ files, hard, soft, unparsed }`.
3. **Trigger.** `POST /api/internal/email/bounces` (same guard/shape as the send route) and a `lixto email bounces` command + `InternalApi.email_bounces()`, mirroring `worker`/`digest`. The maildir path comes from `LIXTO_BOUNCE_MAILDIR` (default `/var/db/mail/bounces`); when the directory does not exist the run reports zeros instead of failing (the web container may not mount it — say so in the report if that is the case, and note the mount the orchestrator must add).

Tests: `bounces.test.ts` with fixture DSNs (Gmail 550 5.1.1 user unknown; a 4.2.2 soft bounce; a malformed blob) asserting the three outcomes and that `suppress` is called only for hard bounces; `tests/test_cli_email.py` gains the `bounces` command cases.

## Checks (run in order — cheapest first)
1. `cd web && npx next typegen && npm run lint && npx tsc --noEmit`
2. `uv run ruff check src tests && uv run ruff format --check src tests`
3. `cd web && npx vitest run lib/email/bounces.test.ts`
4. `uv run pytest tests/test_cli_email.py -q`
5. `cd web && npm test && uv run pytest -q`
6. `docker build -t lixto-mail:test infra/mail`

## Done when
- A Gmail 550 5.1.1 DSN fixture flips the matching row to `failed` and inserts a `hard_bounce` suppression; a 4.x DSN changes nothing; `lixto email bounces` reports the counts.

## Not included
- Complaint/FBL loops, inbound mail for humans, changing the sender's synchronous classification (that stays as-is).
