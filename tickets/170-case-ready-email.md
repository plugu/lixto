---
id: 170
status: done
model: sonnet
depends_on: [168]
max_attempts: 3
files:
  - web/lib/email/outbox.ts
  - web/lib/email/templates.ts
  - web/lib/email/templates.test.ts
  - web/lib/case-queries.ts
  - web/lib/case-queries.test.ts
  - web/lib/case-batch.ts
  - web/lib/case-batch.test.ts
---
## Goal
When a case becomes `ready`, every company admin gets one `case_ready` email with the verdict counts and a button to the case; the batch stamps `email_enqueued_at` so a rerun never sends it twice.

## Context
The outbox is `enqueue(input)` in `web/lib/email/outbox.ts` (`{toEmail, template, payload, companyId, dedupeKey}` → `{id}` or `{id: null, skipped}`); templates are pure `renderTemplate(template, payload)` functions in `web/lib/email/templates.ts` using `renderLayout`, `renderButton`, `escapeHtml` from `./layout` and `formatDateBR` from `../format`. Migration 008 (ticket 168) already allows `'case_ready'` in `email_messages.template`. Recipient selection and dedupe-key style: `listRecipients` / `dedupeKey` in `web/lib/email/digest-batch.ts` (admins = `users.role = 'admin'`; `email` is NOT NULL). `APP_URL = process.env.LIXTO_APP_URL ?? "https://lixto.com.br"` (same file). This mail is transactional: no `List-Unsubscribe` (leave `sender.ts` untouched).

### Work
1. `outbox.ts`: add `| "case_ready"` to `EmailTemplate`.
2. `templates.ts`: `TemplatePayloads.case_ready = { companyName: string; procurementTitle: string; agency: string | null; stateUf: string | null; sessionAt: string | null /* ISO */; met: number; expiring: number; missing: number; manual: number; caseUrl: string }`. `renderCaseReady`: subject `Caso pronto para decidir: ${truncate(procurementTitle, 70)}`; html = `renderLayout` with greeting "Olá, {companyName}", one sentence "O agente montou o caso desta licitação e ele está pronto para a sua decisão.", a line `{agency} · {stateUf}` (skip missing parts), "Sessão pública: dd/mm/aaaa" or "Data da sessão: a confirmar", a counts sentence "Habilitação: {met} atendida(s), {expiring} vence(m) antes da sessão, {missing} falta(m), {manual} para verificar." and `renderButton(caseUrl, "Ver caso e decidir")`; text version with the same lines and the URL. Every dynamic string goes through `escapeHtml` in html. Add the `switch` case. Tests in `templates.test.ts`: subject carries the title; html contains `caseUrl` and the counts sentence; text has no `<` and contains the URL; a title with `<b>` is escaped in html.
3. `case-queries.ts`: `listCasesToEmail(companyId?: number)` → cases with `status = 'ready' AND email_enqueued_at IS NULL` (+ optional company filter), returning `{id, company_id, company_name (COALESCE(NULLIF(trade_name,''), legal_name)), description, agency_name, state_uf, session_at, met, expiring, missing, manual}` (reuse the count subqueries of `listCases`); `listCompanyAdminEmails(companyId): Promise<string[]>`; `stampCaseEmailed(caseId)`. Builder tests for the SQL shape (`email_enqueued_at IS NULL`, `role = 'admin'`).
4. `case-batch.ts`: new step after the compute step — for each `listCasesToEmail(opts.companyId)` row: build the payload (`procurementTitle = description ?? "Licitação"`, `sessionAt = session_at?.toISOString() ?? null`, `caseUrl = ${APP_URL}/cases/${id}`), `enqueue` once per admin email with `dedupeKey = case_ready:${caseId}:${email}`, count `emailed` for each `result.id !== null`, then `stampCaseEmailed(caseId)` even when every enqueue came back `duplicate` (idempotent). A throw for one case increments `failed` and continues. Tests (mock `./email/outbox` and `./case-queries`): two admins → two `enqueue` calls with distinct keys and one stamp; all-duplicate → still stamped, `emailed` 0; zero admins → stamped, nothing enqueued.

Runtime probe preconditions: as ticket 168; the 168 fixture leaves a `ready` case for company 1 with `email_enqueued_at IS NULL` (a fresh case if 168's probe already ran is not needed — the existing one has never been stamped).

## Checks (run in order — cheapest first)
1. `cd web && npm run lint`
2. `cd web && npx vitest run lib/email/templates.test.ts lib/case-queries.test.ts lib/case-batch.test.ts lib/email/outbox.test.ts`
3. `cd web && npx tsc --noEmit`
4. `cd web && npm test`
5. `cd web && npm run build`
6. `docker exec -i plataforma-licitante-db-1 psql -U lixto -d lixto -q < scripts/dev/case-fixture.sql && tok=$(grep -E '^LIXTO_INTERNAL_TOKEN=' web/.env.local | cut -d= -f2- | tr -d '"') && curl -s -X POST -H "x-lixto-internal-token: $tok" localhost:3000/api/internal/cases/run | grep -q '"runId"'`
7. `docker exec plataforma-licitante-db-1 psql -U lixto -d lixto -At -c "select count(*) from email_messages m join cases c on c.id = split_part(m.dedupe_key, ':', 2)::bigint where m.template = 'case_ready' and c.company_id = 1 and c.email_enqueued_at is not null" | grep -Eq '^[1-9]'`
8. `tok=$(grep -E '^LIXTO_INTERNAL_TOKEN=' web/.env.local | cut -d= -f2- | tr -d '"') && before=$(docker exec plataforma-licitante-db-1 psql -U lixto -d lixto -At -c "select count(*) from email_messages where template = 'case_ready'") && curl -s -X POST -H "x-lixto-internal-token: $tok" localhost:3000/api/internal/cases/run > /dev/null && after=$(docker exec plataforma-licitante-db-1 psql -U lixto -d lixto -At -c "select count(*) from email_messages where template = 'case_ready'") && test "$before" = "$after"`

## Done when
- All eight checks green: one `case_ready` row per admin for the fixture case, the case stamped, and a second run enqueues nothing.

## Not included
- Sending (the existing `email-worker` schedule drains the outbox); unsubscribe for this template; WhatsApp or push.
- Reminder emails before the session; digest changes.
