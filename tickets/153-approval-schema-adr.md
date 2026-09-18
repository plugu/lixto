---
id: 153
status: done
model: sonnet
depends_on: []
max_attempts: 4
files:
  - migrations/007_company_approval.sql
  - docs/adr/003-gated-signup-superadmin.md
  - docs/DATA_MODEL.md
  - tests/test_db.py
---
## Goal
Add company approval status, the per-user superadmin flag and the four new email template names to the schema, with every existing company backfilled as approved.

## Context
Read `docs/adr/001-lixto-data-model.md` ("users", "companies") and `migrations/003_email.sql` (the `email_messages.template` CHECK) first. Migrations are applied in filename order by `src/lixto/db.py:run_migrations` (`lixto db init`), each file once, inside a transaction. Schema 1.0 tables are extended with ALTER, never rewritten.

Write `migrations/007_company_approval.sql` (header comment: cycle 28, ticket 153):
1. `ALTER TABLE companies ADD COLUMN approval_status TEXT NOT NULL DEFAULT 'approved' CHECK (approval_status IN ('pending','approved','rejected'))` — the default backfills every existing row — then `ALTER TABLE companies ALTER COLUMN approval_status SET DEFAULT 'pending'` so new signups start pending. Add `approval_reason TEXT`, `approval_changed_at TIMESTAMPTZ`, `approval_changed_by BIGINT REFERENCES users (id) ON DELETE SET NULL`. `CREATE INDEX idx_companies_approval_status ON companies (approval_status)`.
2. `ALTER TABLE users ADD COLUMN is_superadmin BOOLEAN NOT NULL DEFAULT false`.
3. Replace the template CHECK: `ALTER TABLE email_messages DROP CONSTRAINT email_messages_template_check; ALTER TABLE email_messages ADD CONSTRAINT email_messages_template_check CHECK (template IN ('welcome','invite','password_reset','daily_digest','signup_received','signup_pending_admin','signup_approved','signup_rejected'))`.
4. Comment each column with its meaning (who/when changed, reason shown to the applicant on rejection).

Write `docs/adr/003-gated-signup-superadmin.md` (≤1 page, same layout as ADR 002: Context / Decision D1–D4 / Consequences): D1 approval is per company, not per user (invitees inherit); D2 superadmin is a boolean on `users`, not a third `role` value (company role and platform role are orthogonal), granted only by CLI; D3 `getSession` refuses non-approved companies so revocation is immediate; D4 status mails ride the ADR 002 outbox, enqueued in the same transaction as the status change.

Update `docs/DATA_MODEL.md` sections `companies` and `users` with the new columns. Add a test in `tests/test_db.py` that `list_migration_files` returns `007_company_approval.sql` after `006_tender_analysis.sql` (follow the existing pattern in that file).

## Checks (run in order — cheapest first)
1. `uv run ruff check src tests`
2. `uv run pytest tests/test_db.py -q`
3. `LIXTO_DATABASE_URL=postgresql://lixto:lixto@localhost:5433/lixto uv run lixto db init`
4. `docker compose -f /Users/aazevedo/dev/plataforma-licitante/docker-compose.yml exec -T db psql -U lixto -d lixto -Atc "SELECT count(*) FROM companies WHERE approval_status <> 'approved'" | grep -qx 0 && docker compose -f /Users/aazevedo/dev/plataforma-licitante/docker-compose.yml exec -T db psql -U lixto -d lixto -Atc "SELECT column_default FROM information_schema.columns WHERE table_name='companies' AND column_name='approval_status'" | grep -q pending && docker compose -f /Users/aazevedo/dev/plataforma-licitante/docker-compose.yml exec -T db psql -U lixto -d lixto -Atc "SELECT is_superadmin FROM users LIMIT 1" | grep -qx f`

## Done when
- `lixto db init` on the dev DB applies 007 idempotently; every pre-existing company is `approved`; a fresh `INSERT INTO companies` defaults to `pending`; `INSERT INTO email_messages (..., template) VALUES (..., 'signup_received')` is accepted.

## Not included
- Any web or CLI code; README changes (160).
