-- Ticket 108: transactional email outbox (cycle 22).
--
-- Every send is a row: the business event and its mail are written in the same
-- transaction (see web/lib/email/outbox.ts `enqueue(input, client)`), so a
-- crash between "user created" and "welcome sent" is impossible. A worker
-- claims batches with FOR UPDATE SKIP LOCKED, so two runners never take the
-- same message. See docs/adr/002-transactional-email.md.

CREATE TABLE email_messages (
    id            BIGSERIAL PRIMARY KEY,
    to_email      TEXT NOT NULL,                        -- lowercased by the caller
    company_id    BIGINT REFERENCES companies (id) ON DELETE SET NULL,
    user_id       BIGINT REFERENCES users (id) ON DELETE SET NULL,
    template      TEXT NOT NULL CHECK (template IN ('welcome','invite','password_reset','daily_digest')),
    payload       JSONB NOT NULL DEFAULT '{}',          -- render variables (ticket 110)
    subject       TEXT,                                 -- filled at render time
    status        TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sending','sent','failed','suppressed')),
    attempts      INTEGER NOT NULL DEFAULT 0,           -- incremented on claim
    last_error    TEXT,                                 -- last SMTP reply / exception
    message_id    TEXT,                                 -- MTA Message-ID once accepted
    dedupe_key    TEXT,                                 -- e.g. 'daily_digest:<company>:<date>'
    scheduled_for TIMESTAMPTZ NOT NULL DEFAULT now(),   -- retry backoff moves this forward
    sent_at       TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Partial unique: only keyed messages dedupe (one digest per company per day).
-- The enqueue INSERT repeats the predicate in its ON CONFLICT target so
-- Postgres can infer this index.
CREATE UNIQUE INDEX idx_email_messages_dedupe ON email_messages (dedupe_key) WHERE dedupe_key IS NOT NULL;

-- The worker's only scan: due queued rows, plus in-flight ones for recovery.
CREATE INDEX idx_email_messages_queue ON email_messages (status, scheduled_for) WHERE status IN ('queued','sending');

CREATE TABLE email_suppressions (
    email      TEXT PRIMARY KEY,                        -- lowercased
    reason     TEXT NOT NULL CHECK (reason IN ('hard_bounce','complaint','unsubscribe','manual')),
    detail     TEXT,                                    -- bounce text / who suppressed it
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
