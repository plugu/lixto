---
id: 108
status: doing
model: opus
depends_on: []
max_attempts: 4
files:
  - migrations/003_email.sql
  - web/lib/email/outbox.ts
  - web/lib/email/outbox.test.ts
  - docs/adr/002-transactional-email.md
---
## Goal
The outbox exists: `email_messages` + `email_suppressions` tables, and a transaction-safe enqueue/claim/settle API the rest of the cycle builds on.

## Context

Schema 1.0 lives in `migrations/001_core.sql`; migration 002 (`002_document_texts_ocr.sql`) widened one CHECK. `db.run_migrations` applies pending files by filename order on `lixto db init` (every cli deploy). Web query modules are flat files in `web/lib/*-queries.ts` using `pool` from `@/lib/db`; tests mock `pool.query` (see `web/lib/match-queries.test.ts`).

`migrations/003_email.sql`:
```sql
CREATE TABLE email_messages (
    id BIGSERIAL PRIMARY KEY,
    to_email TEXT NOT NULL,                    -- lowercased
    company_id BIGINT REFERENCES companies (id) ON DELETE SET NULL,
    user_id BIGINT REFERENCES users (id) ON DELETE SET NULL,
    template TEXT NOT NULL CHECK (template IN ('welcome','invite','password_reset','daily_digest')),
    payload JSONB NOT NULL DEFAULT '{}',
    subject TEXT,
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sending','sent','failed','suppressed')),
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    message_id TEXT,                           -- MTA Message-ID once accepted
    dedupe_key TEXT,                           -- e.g. 'daily_digest:<company>:<date>'
    scheduled_for TIMESTAMPTZ NOT NULL DEFAULT now(),
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_email_messages_dedupe ON email_messages (dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX idx_email_messages_queue ON email_messages (status, scheduled_for) WHERE status IN ('queued','sending');
CREATE TABLE email_suppressions (
    email TEXT PRIMARY KEY,                    -- lowercased
    reason TEXT NOT NULL CHECK (reason IN ('hard_bounce','complaint','unsubscribe','manual')),
    detail TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

`web/lib/email/outbox.ts` (all params bound, never interpolated):
- `enqueue(input, client?)` — `{ toEmail, template, payload, companyId?, userId?, dedupeKey?, scheduledFor? }`. Lowercases the address; returns `{ id, skipped: "suppressed" | "duplicate" } | { id }`. Skips (no row) when the address is in `email_suppressions`; `ON CONFLICT (dedupe_key) DO NOTHING` covers the duplicate case. Optional `client` so callers can enqueue inside their own transaction (signup, invite).
- `claimBatch(limit)` — `UPDATE ... SET status='sending', attempts=attempts+1 ... WHERE id IN (SELECT id FROM email_messages WHERE status='queued' AND scheduled_for <= now() ORDER BY scheduled_for LIMIT $1 FOR UPDATE SKIP LOCKED) RETURNING *` (two runners never take the same row).
- `markSent(id, messageId)`, `markFailed(id, error, { retryable })` — retryable → back to `queued` with `scheduled_for = now() + backoff(attempts)` (`BACKOFF_MINUTES = [1, 5, 30, 120]`, `MAX_ATTEMPTS = 5`); non-retryable or attempts exhausted → `failed`.
- `suppress(email, reason, detail?)` — upsert into `email_suppressions` and mark that address's queued rows `suppressed`.
- `isSuppressed(email)`, `emailStats()` → `{ queued, sent24h, failed24h, suppressed }` for `lixto status` (ticket 113).

`docs/adr/002-transactional-email.md`: decision record — outbox over fire-and-forget; self-hosted Postfix direct-to-MX on the Hostinger VPS (port 25 open, 5 msg/min cap); Terraform owns only the Cloudflare DNS records; PTR is manual; relayhost is the documented escape hatch; suppression policy (transactional mail is not unsubscribable, digest is).

Tests (vitest, mocked `pool`): enqueue lowercases + skips suppressed + honours dedupe; claimBatch SQL contains `FOR UPDATE SKIP LOCKED`; markFailed reschedules with the right backoff and gives up at MAX_ATTEMPTS; suppress cascades to queued rows.

## Checks (run in order — cheapest first)
1. `cd web && npm run lint`
2. `cd web && npx tsc --noEmit`
3. `cd web && npx vitest run lib/email/outbox.test.ts`
4. `cd web && npm test`
5. `grep -q "FOR UPDATE SKIP LOCKED" web/lib/email/outbox.ts && grep -q "email_suppressions" migrations/003_email.sql`

## Done when
- `enqueue` returns without inserting for a suppressed address and for a repeated `dedupeKey`; `claimBatch` emits `FOR UPDATE SKIP LOCKED`; `markFailed` schedules the next attempt per `BACKOFF_MINUTES` and lands on `failed` after `MAX_ATTEMPTS`.
- Migration 003 applies on a DB at 002 (`lixto db init` against the local compose Postgres; if it isn't running, say so in the report).

## Not included
- Rendering templates (ticket 110), SMTP transport (111), call sites (112), CLI/status (113), Terraform/MTA (109).
