---
id: 162
status: todo
model: sonnet
depends_on: [161]
max_attempts: 4
files:
  - web/lib/company-approval-queries.ts
  - web/lib/company-approval-queries.test.ts
  - web/app/(app)/admin/companies/page.tsx
  - web/components/admin/companies-table.tsx
  - web/lib/email/templates.ts
  - web/lib/email/templates.test.ts
  - web/lib/email/outbox.ts
  - migrations/008_drop_welcome_template.sql
  - src/lixto/cli/users.py
  - tests/test_cli_users.py
---
## Goal
Post-ship follow-ups from the cycle 28 reviewer pass (non-gating).

## Context
Reviewer findings F7, F9, F12, F18 over e7f8206..91f6417. Not required for go-live; schedule after the prod grant.

Work:
1. **(F7)** `buildListCompaniesByStatus(status, limit, offset)` with bound `LIMIT $2 OFFSET $3` (default 100) + a "Carregar mais" control on `/admin/companies` (URL param `page`, same pattern as the procurements list).
2. **(F9)** Retire the orphaned `welcome` template: remove `renderWelcome`, its payload type, the `EmailTemplate` member and add `migrations/008_drop_welcome_template.sql` replacing the CHECK without `'welcome'` — only after confirming `SELECT count(*) FROM email_messages WHERE template='welcome' AND status IN ('queued','sending')` is 0 in prod (document that precondition in the migration header).
3. **(F12)** Replace the `<details>` + `window.confirm()` reject flow with the app's dialog/toast affordance used in `opportunity-feedback.tsx`; add `aria-expanded` if a disclosure remains.
4. **(F18)** `lixto users grant/revoke-superadmin`: check the row before `commit()`, and report `already granted` / `already revoked` when the flag was unchanged (RETURNING the pre-update value via a CTE or `xmax` trick is not needed — read it first in the same transaction).

## Checks (run in order — cheapest first)
1. `cd web && npm run lint && npx tsc --noEmit`
2. `cd web && npm test`
3. `uv run ruff check src tests && uv run pytest tests/test_cli_users.py -q`
4. `cd web && npm run build`

## Done when
- Aprovadas tab pages at 100 rows; `welcome` no longer exists in code or CHECK; reject uses the shared dialog; CLI distinguishes no-op grants.

## Not included
- New features; changes to the approval semantics.
