-- Cycle 28 (ticket 153): gated signup — company approval status, per-user
-- superadmin flag, and the four new signup email templates.
--
-- Every existing company is backfilled `approved` (the ADD COLUMN default),
-- then the default flips to `pending` so only *new* signups start gated.
-- See docs/adr/003-gated-signup-superadmin.md.

ALTER TABLE companies ADD COLUMN approval_status TEXT NOT NULL DEFAULT 'approved'
    CHECK (approval_status IN ('pending', 'approved', 'rejected'));
ALTER TABLE companies ALTER COLUMN approval_status SET DEFAULT 'pending';
COMMENT ON COLUMN companies.approval_status IS
    'pending|approved|rejected. New signups start pending; existing rows were backfilled approved by this migration.';

ALTER TABLE companies ADD COLUMN approval_reason TEXT;
COMMENT ON COLUMN companies.approval_reason IS
    'Optional note shown to the applicant when a superadmin rejects the company.';

ALTER TABLE companies ADD COLUMN approval_changed_at TIMESTAMPTZ;
COMMENT ON COLUMN companies.approval_changed_at IS
    'When approval_status last changed (approve or reject). NULL for the pre-existing, never-touched rows.';

ALTER TABLE companies ADD COLUMN approval_changed_by BIGINT REFERENCES users (id) ON DELETE SET NULL;
COMMENT ON COLUMN companies.approval_changed_by IS
    'Superadmin user who last approved or rejected this company. NULL for the pre-existing, never-touched rows.';

CREATE INDEX idx_companies_approval_status ON companies (approval_status);

ALTER TABLE users ADD COLUMN is_superadmin BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN users.is_superadmin IS
    'Platform-wide admin flag, orthogonal to the per-company users.role. Granted/revoked only via CLI (lixto users grant-superadmin/revoke-superadmin).';

-- Widen the outbox to the four gated-signup mails (ADR 002's outbox, ADR 003 D4).
ALTER TABLE email_messages DROP CONSTRAINT email_messages_template_check;
ALTER TABLE email_messages ADD CONSTRAINT email_messages_template_check
    CHECK (template IN ('welcome', 'invite', 'password_reset', 'daily_digest',
                         'signup_received', 'signup_pending_admin', 'signup_approved', 'signup_rejected'));
