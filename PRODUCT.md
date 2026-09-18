---
mode: production
routing_profile: cloud
parallel_default: sequential
---

# Lixto — Gated signup + superadmin (cycle 28)

## What / why
Today `/signup` creates the company and its first admin, opens a session and drops the visitor straight into the app. Anyone with a CNPJ gets full access, including LLM-spending features, with no human in the loop. This cycle turns signup into an application: the company starts **pending**, a platform **superadmin** (initially only the owner) approves or rejects it from a new menu entry, and email tells the applicant where they stand at each step.

Repo facts that shape the work:
- `users.role` (`admin|member`) is a *company* role; there is no platform role. Superadmin is a new per-user flag, granted only by CLI, never from the UI.
- `companies` has no status column. Approval is per company; a new migration `migrations/007_company_approval.sql` adds it (schema 1.0 tables in `001_core.sql` are extended by ALTER, not rewritten; read `docs/adr/001-lixto-data-model.md` first).
- Email goes through `web/lib/email/outbox.ts` + `templates.ts` (typed `TemplatePayloads`), drained by the `email-worker` schedule. New mails are new template keys, same pipeline.
- Auth gates live in `web/lib/auth.ts` (`getSession`, `requireSession`, `requireAdmin`, `login`); sidebar nav in `web/components/sidebar.tsx` gates on `session.role`.
- Invites (`/company/users`, `/invite`) are created by an already-approved company's admin and stay ungated.

## Primary user story
As the Lixto owner, I receive an email when a company signs up, open **Administração → Empresas** from the sidebar, see its CNPJ, razão social, admin name/email and signup date, and click *Aprovar* or *Rejeitar* (with an optional reason). The applicant receives "estamos avaliando seu cadastro" right after signup, then "acesso liberado" or "cadastro não aprovado", and can only log in once approved.

## Behaviour
- Signup: creates company (`pending`) + admin user, **no session**; redirects to `/signup/recebido` ("Cadastro recebido, estamos avaliando"). Enqueues `signup_received` to the applicant and `signup_pending_admin` to every superadmin.
- Login while pending or rejected: correct credentials do **not** create a session; login page shows "conta em análise" / "cadastro não aprovado". `getSession` also refuses sessions of non-approved companies (defence in depth).
- Approve: company → `approved`, records who/when, enqueues `signup_approved` (link to `/login`). Reject: → `rejected` with optional reason, enqueues `signup_rejected`. Both idempotent; rejecting an approved company is allowed (revokes access, sessions die on next request).
- Superadmin flag: `users.is_superadmin BOOLEAN NOT NULL DEFAULT false`; granted/revoked by `lixto users grant-superadmin <email>` / `revoke-superadmin`. Superadmin sees an extra sidebar group **Administração** with **Empresas** (`/admin/companies`, tabs Pendentes / Aprovadas / Rejeitadas, pending count badge). Non-superadmins get 404 on `/admin/*`.
- Migration backfills every existing company as `approved` so prod users are untouched. Owner's user gets the flag via CLI after deploy.

## Out of scope
- Granting superadmin from the UI; superadmin managing users inside companies
- Per-user approval of invitees; per-seat limits or plans
- Editing company data from the admin page; audit log beyond approved/rejected by+at
- Marketing site copy; Python-side changes beyond the one CLI command
- Rate limiting / captcha on signup

## Success demo
Done when I can sign up a fresh CNPJ on prod, get the "estamos avaliando" email and no access, see the pending company under Administração → Empresas as superadmin, approve it, receive the "acesso liberado" email, and log in with those credentials.

1. `cd web && npm run lint && npm run build && npm test` green; `ruff check src && pytest` green.
2. Dev DB + `npm run dev`: signup → 303 to `/signup/recebido`, no `Set-Cookie`; `emails` outbox holds `signup_received` + `signup_pending_admin`; login with those credentials → 200 with "conta em análise", no cookie; `lixto users grant-superadmin <dev email>` → sidebar shows Administração (curl with `lixto_session=devprobe`); approve → outbox holds `signup_approved`; login now sets cookie.
3. Prod: after deploy + migration + CLI grant, the demo sentence above end-to-end.
