---
id: 160
status: done
model: haiku
depends_on: [154, 156, 158, 159]
max_attempts: 4
files:
  - README.md
  - CLAUDE.md
  - STATE.md
---
## Goal
Docs describe the gated signup, the superadmin CLI and the prod go-live steps; STATE.md reflects cycle 28.

## Context
README has "### CLI Commands" blocks per area (see the Email section around line 209) and a "Deploy Runbook" section; `lixto db init` already runs on every `lixto-cli` deploy, so migration 007 applies itself. CLAUDE.md has "Key Code Locations" and "Guiding Principles". STATE.md is rewritten (never appended), ≤30 lines, sections Now / Next / Decisions / Blockers.

Work:
1. README: new "### Users & access" subsection under CLI reference: `lixto users grant-superadmin <email>`, `revoke-superadmin`, `list-superadmins`; a short "Signup approval" paragraph (pending → superadmin approves at Administração → Empresas → emails); Deploy Runbook gets a "Cycle 28 go-live" step: after deploy, `docker exec <lixto-cli> lixto users grant-superadmin alxazevedo@gmail.com`, then verify `/admin/companies` renders. Add the four templates to the "Templates" list.
2. CLAUDE.md: Key Code Locations rows for `web/lib/auth.ts` (session gate + `requireSuperadmin`), `web/app/(app)/admin/*`, `web/lib/company-approval-queries.ts`, `src/lixto/cli/users.py`, `migrations/007_company_approval.sql`; a one-line note under Lixto Core: "Signup is gated: companies start `pending`; only superadmins (CLI flag) approve."
3. STATE.md: Now = cycle 28 shipped (commit hash left as `<pending>` for the orchestrator to fill), tickets 153–160; Next = prod grant + first real approval; Decisions = per-company approval, CLI-only superadmin, session gate in `getSession`.

## Checks (run in order — cheapest first)
1. `grep -q 'grant-superadmin' README.md && grep -q 'signup_rejected' README.md && grep -q 'requireSuperadmin' CLAUDE.md`
2. `test $(wc -l < STATE.md) -le 30`

## Done when
- A new operator can follow README alone to grant superadmin and approve a company.

## Not included
- Code changes of any kind; ADR (153).
