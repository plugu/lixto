# ADR 002 — Transactional email: persisted outbox + self-hosted MTA

- Status: accepted (cycle 22, 2026-09-03)
- Deciders: Alex Azevedo (product), forge plan
- Scope: `migrations/003_email.sql`, `web/lib/email/*`, `lixto email *`, `infra/terraform/`
- Related: ADR 001 (core data model), PRODUCT.md cycle 22, VISION §12 (notifications)

## Context

Lixto could not reach a user outside the browser. `users` already carries
`email` and `invite_token_hash`/`invite_expires_at`, but nothing sent them:
invites were dead on arrival, there was no password reset, and the cycle-19
digest only existed if somebody opened `/lixto`. The proactive loop is
pointless if its output never leaves the database.

Two decisions had to be made: *how* a send is recorded (in-process call vs.
persisted queue) and *who* delivers it (third-party API vs. our own MTA).

## Decision

### D1. An outbox table, not fire-and-forget

Every send is a row in `email_messages` (migration 003), written **in the same
transaction as the business event that caused it**. `enqueue(input, client)`
takes an optional `PoolClient`, so signup writes company + user + welcome mail
atomically: a crash between them cannot produce a user with no welcome mail or
a welcome mail for a user that was rolled back.

Consequences we accept:

- Mail is never sent inside the request. The user's HTTP response does not wait
  on an SMTP handshake, and a slow or dead MTA degrades to "delivered a few
  minutes later", not "signup failed".
- Delivery state is queryable. `status` ∈
  `queued|sending|sent|failed|suppressed`, with `attempts`, `last_error`,
  `message_id` and `sent_at`. `lixto status` reads it (queued / sent 24 h /
  failed 24 h / suppressed) so silent non-delivery is visible instead of being
  discovered by a user.
- Retries are bounded and explicit. `BACKOFF_MINUTES = [1, 5, 30, 120]`,
  `MAX_ATTEMPTS = 5`: a retryable failure goes back to `queued` with
  `scheduled_for` pushed out; a non-retryable one (5xx, invalid address) or the
  last attempt lands on `failed` with the SMTP reply in `last_error`. Four
  backoff steps for five attempts is intentional — the fifth failure ends it.

### D2. Claiming with `FOR UPDATE SKIP LOCKED`

`lixto email worker` runs on a Dokploy schedule every 5 minutes; a slow run can
overlap the next one. `claimBatch` therefore flips rows to `sending` in one
statement whose subquery ends in `FOR UPDATE SKIP LOCKED`, so a second runner
skips locked rows instead of waiting on them or, worse, re-sending them.
`attempts` is incremented at claim time, which also makes a crashed runner
visible: the row sits in `sending` with a burnt attempt rather than looking
fresh.

No `LISTEN/NOTIFY`, no broker, no Redis. At this volume Postgres is the queue,
and the alternative would add a component that can fail independently of the
data it guards.

### D3. Dedupe by key, not by content

`dedupe_key` is unique **while non-null** (partial index), e.g.
`daily_digest:<company>:<date>`. A repeated key is dropped by
`ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING` — note that
the predicate must be repeated in the conflict target for Postgres to infer a
partial index. Account mail passes no key (two invites are two emails); the
digest passes one, so re-running `lixto email digest` on the same day is a
no-op instead of a second inbox copy.

### D4. Suppression list, and what it does and does not cover

`email_suppressions` is keyed by the lowercased address, with `reason` ∈
`hard_bounce|complaint|unsubscribe|manual`. `enqueue` checks it **before**
inserting, so a suppressed address produces no row at all (`skipped:
"suppressed"`), and `suppress()` also flips that address's already-`queued`
rows to `suppressed`. In-flight (`sending`) rows are left to their runner.

Policy: **account mail is transactional and not unsubscribable** (welcome,
invite, password reset — a user who cannot receive them cannot use the
product); **digest mail is**, via a footer link that inserts an `unsubscribe`
row. Because suppression is per address and not per template, unsubscribing
from the digest today also stops account mail to that address. That is the
simplification we accept for cycle 22; a `template_scope` column is the obvious
extension when per-template preferences arrive (PRODUCT.md puts them out of
scope).

Addresses are lowercased at the boundary (`normalizeEmail`) so the suppression
key and `to_email` always compare equal.

### D5. Self-hosted Postfix, direct-to-MX

Delivery is Postfix + opendkim as a container on `plugu-prod01` (Hostinger BR,
187.127.16.246), reachable only on the internal Docker network for submission
and delivering **direct to the recipient's MX on port 25** (verified open).
Hostinger caps outbound at ~5 messages/minute, so the transport is rate-limited
with `default_destination_rate_delay` and the outbox absorbs bursts — which is
exactly what a queue is for.

Rejected: a transactional-email API (SES/Resend/Postmark). It would be easier
to get into inboxes, but it adds a per-message cost, a vendor account, and a
second source of truth for delivery state. We already run the VPS, port 25 is
open, and the outbox makes the transport swappable.

The cost is real and stated: a cold IP is filtered until reputation builds, and
bounce handling is ours (bounces are parsed back into `email_messages` /
`email_suppressions`). The **escape hatch is a config line, not a code change**:
pointing Postfix's `relayhost` at an external submission service on 587/465
switches delivery without touching the outbox, the renderer or any call site.

### D6. Terraform owns the DNS records and nothing else

`infra/terraform/` manages exactly these Cloudflare records on `lixto.com.br`:
`mail.lixto.com.br` A → the VPS **grey-cloud (`proxied = false`, Cloudflare does
not proxy SMTP)**, `MX 10 mail`, SPF replacing today's deny-all `v=spf1 -all`,
the DKIM selector TXT, and DMARC `p=none` with a `rua` mailbox.

The DKIM **private key is generated inside the MTA volume and never enters
Terraform state** — only the public half is a TXT record. MTA configuration,
Dokploy objects and everything else stay as they are; this is not a
"Terraform everything" cycle.

**Manual prerequisite, no provider for it**: the PTR for 187.127.16.246 must be
changed at Hostinger from `srv1897779.hstgr.cloud` to `mail.lixto.com.br`.
Without forward-confirmed rDNS, Gmail and Outlook reject or spam-file
everything, and no amount of SPF/DKIM compensates.

## Consequences

- Migration 003 adds two tables and touches nothing from schema 1.0.
- `web/lib/email/outbox.ts` is the only writer of the queue; SMTP (ticket 111),
  rendering (110), call sites (112) and the CLI (113) build on its API.
- Deliverability is an operational concern with an owner: `lixto status`
  surfaces the counters, and the relayhost hatch is the documented fallback if
  reputation never builds.
