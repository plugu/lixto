-- Ticket 120 (review follow-up): indexes backing the bounce ingester's two
-- lookups in web/lib/email/bounces.ts. Without them each DSN full-scans
-- email_messages: idx_email_messages_queue only covers queued/sending rows.

-- Message-ID match (angle brackets stripped on both sides).
CREATE INDEX idx_email_messages_message_id
    ON email_messages (btrim(message_id, '<>'), to_email)
    WHERE message_id IS NOT NULL;

-- Newest-sent-to-recipient fallback.
CREATE INDEX idx_email_messages_recipient_sent
    ON email_messages (to_email, sent_at DESC)
    WHERE status = 'sent';
