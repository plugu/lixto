---
id: 115
status: done
model: opus
depends_on: []
max_attempts: 4
files:
  - web/proxy.ts
  - web/lib/email/unsubscribe.ts
  - web/app/(app)/email/unsubscribe/route.ts
  - web/lib/email/callsites.test.ts
  - .env.example
  - web/.env.example
---
## Goal
The unsubscribe link works from a logged-out inbox, cannot be forged, and cannot be triggered by a link scanner.

## Context

Reviewer findings (cycle 22), all in the one user-facing mutation of `email_suppressions`:
1. **Unreachable** — `web/proxy.ts:10` `PUBLIC_PREFIXES` omits `/email/unsubscribe`, so the link redirects to `/login`, and line 42 sets `url.search = ""`, discarding `?email=&token=`. Every digest unsubscribe is broken. Add the prefix; assert with a test that a request without a session cookie reaches the handler.
2. **Forgeable** — `web/lib/email/unsubscribe.ts:22` falls back to `process.env.LIXTO_INTERNAL_TOKEN ?? ""`, and `web/.env.example` ships it empty: an empty-key HMAC anyone can compute, and ADR D4 suppression is address-wide (blocks welcome/invite/reset too). Use a **dedicated** `LIXTO_UNSUBSCRIBE_SECRET`; when it is unset, `unsubscribeToken` must throw and `verifyUnsubscribeToken` must return false (never a computable token). Document the new var in both `.env.example` files.
3. **Prefetch-unsafe + not one-click compliant** — the route only exports `GET` and mutates on it, so a scanner prefetch silently suppresses an address, while Gmail/Yahoo one-click POST gets 405. Add `POST` that performs the suppression (accepting `email`/`token` from query or `application/x-www-form-urlencoded` body, as `List-Unsubscribe-Post` senders do), and make `GET` render a small pt-BR confirmation **form** that posts to itself — GET must not mutate.
4. While in `.env.example`: move the inline trailing comments onto their own line and quote `LIXTO_EMAIL_FROM="Lixto <nao-responda@lixto.com.br>"` — today `--env-file` swallows the comment into the value and `set -a; . .env` breaks on the angle brackets.

Tests go in the existing `web/lib/email/callsites.test.ts`: token throws/verify-false without the secret; a tampered or length-mismatched token fails; GET renders the form and calls no `suppress`; POST with a valid token suppresses once; POST with a bad token 400s and suppresses nothing. Keep the existing tests passing.

## Checks (run in order — cheapest first)
1. `cd web && npx next typegen && npm run lint`
2. `cd web && npx tsc --noEmit`
3. `cd web && npx vitest run lib/email/callsites.test.ts`
4. `cd web && npm test`
5. `cd web && npm run build`
6. `grep -q "/email/unsubscribe" web/proxy.ts && grep -q "LIXTO_UNSUBSCRIBE_SECRET" .env.example web/.env.example`

## Done when
- A logged-out GET to `/email/unsubscribe?email=…&token=…` renders the confirmation form (no suppression); the form's POST suppresses; an unset secret makes every token invalid instead of forgeable.

## Not included
- `List-Unsubscribe-Post` header emission (ticket 117 owns `sender.ts`), suppression re-check at send time (117), outbox changes (116).
