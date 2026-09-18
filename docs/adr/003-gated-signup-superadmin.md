# ADR 003 — Gated signup: company approval + superadmin

- Status: accepted (cycle 28, 2026-09-18)
- Deciders: Alex Azevedo (product), forge plan
- Scope: `migrations/007_company_approval.sql`, `web/lib/auth.ts`, `web/app/(app)/admin/*`, `lixto users grant-superadmin/revoke-superadmin`
- Related: ADR 001 (core data model), ADR 002 (transactional email outbox), PRODUCT.md cycle 28

## Context

`/signup` today creates the company and its first admin, opens a session, and
drops the visitor straight into the app. Anyone with a CNPJ gets full access,
including LLM-spending features, with no human in the loop. This cycle turns
signup into an application: the company starts pending, a platform superadmin
approves or rejects it, and email tells the applicant where it stands at each
step.

## Decision

### D1. Approval is per company, not per user

`companies` gets `approval_status` (`pending|approved|rejected`), not
`users`. Invitees join an already-approved company via `/invite` (ungated,
unchanged) and inherit its status automatically — there is no per-user
approval state to track, and revoking a company revokes every seat in it at
once. This matches `company_profiles`/`company_documents`: identity and
standing are properties of the tenant, not the individual seat.

### D2. Superadmin is a boolean on `users`, not a third `role` value

`users.role` (`admin|member`) is already a *company* role — who can manage
that tenant's users and profile. Platform-wide admin is a different axis
entirely (can this person approve *other companies*?), so it is a second,
orthogonal column: `users.is_superadmin BOOLEAN NOT NULL DEFAULT false`.
Folding it into `role` would make `role IN ('admin','member','superadmin')`
ambiguous — a superadmin still needs a normal company and a normal company
role inside it. `is_superadmin` is granted and revoked only by CLI
(`lixto users grant-superadmin <email>` / `revoke-superadmin`), never from the
UI or an API route — there is no signup flow that should ever produce one.

### D3. `getSession` refuses non-approved companies

Login only issues a session when the company is `approved`; correct
credentials on a `pending` or `rejected` company get a message, not a cookie.
`getSession` repeats the check on every request (defence in depth): if a
superadmin rejects a company while its users are mid-session, those sessions
die on their next request instead of surviving until they expire. This is
the same "recheck, don't just gate at the door" pattern the codebase already
uses for suppressed email addresses (ADR 002 D4) — the state that matters is
read live, not cached in the token.

### D4. Status mails ride the ADR 002 outbox, in the same transaction

`signup_received`, `signup_pending_admin`, `signup_approved`, and
`signup_rejected` are new `email_messages.template` values (migration 007
replaces the CHECK constraint), not a new mechanism. Signup enqueues
`signup_received` (to the applicant) and `signup_pending_admin` (to every
superadmin) in the same transaction as the company/user INSERT; approve/reject
enqueue `signup_approved`/`signup_rejected` in the same transaction as the
`approval_status` UPDATE. This inherits every outbox guarantee for free: a
crash between "company approved" and "mail sent" is impossible, and delivery
is queryable via `lixto status`.

## Consequences

- Migration 007 extends `companies` (4 columns + 1 index) and `users`
  (1 column) by ALTER, and widens `email_messages_template_check` — schema 1.0
  tables are never rewritten (ADR 001).
- Every pre-existing company is backfilled `approved` by the ADD COLUMN
  default before that default flips to `pending`, so prod tenants are
  untouched; only signups *after* the migration start gated.
- `company role` and `platform role` stay independently queryable and
  independently grantable — a superadmin does not need `role = 'admin'` in
  their own company, and revoking superadmin never touches `role`.
- The sidebar's **Administração** group and the `/admin/companies` gate both
  read `session.isSuperadmin`, a new field `getSession` must populate from
  this column (ticket 157).
