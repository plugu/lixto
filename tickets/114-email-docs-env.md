---
id: 114
status: doing
model: haiku
depends_on: [108, 109, 110, 111, 112, 113]
max_attempts: 4
files:
  - .env.example
  - web/.env.example
  - README.md
  - docs/ARCHITECTURE.md
  - docs/DATA_MODEL.md
  - docs/VISION.md
  - CLAUDE.md
---
## Goal
Env templates and docs describe the email path end to end, including the deploy runbook and the manual DNS/PTR prerequisites.

## Context

Ground in code: `migrations/003_email.sql`, `web/lib/email/*` (`outbox.ts`, `templates.ts`, `sender.ts`, `digest-batch.ts`, `unsubscribe.ts`), `web/app/api/internal/email/{send,digest}/route.ts`, `src/lixto/cli/email.py`, `src/lixto/status.py`, `infra/mail/*`, `infra/terraform/*`, `docs/adr/002-transactional-email.md`.

Env vars introduced this cycle (document commented, with prod-shaped examples):
```
LIXTO_SMTP_HOST=lixto-mail          # in-network MTA (Dokploy service name)
LIXTO_SMTP_PORT=25
LIXTO_EMAIL_FROM=Lixto <nao-responda@lixto.com.br>
LIXTO_EMAIL_REPLY_TO=
LIXTO_APP_URL=https://lixto.com.br
```
(web needs all of them; the CLI needs none — it only triggers the internal routes.)

- **README.md** — new "Transactional email" section: outbox model, the four templates, `lixto email worker` / `lixto email digest`, the two Dokploy schedules (`email-worker` `*/5 * * * *`, `email-digest` `30 8 * * *`, both on lixto-cli), and a deploy runbook: `terraform -chdir=infra/terraform apply` (Cloudflare records) → deploy the `lixto-mail` app from `infra/mail/Dockerfile` → read the DKIM public key from its logs and re-apply Terraform → **set PTR for 187.127.16.246 to `mail.lixto.com.br` in Hostinger hPanel** → send a test → verify SPF/DKIM/DMARC in the Gmail "show original" view. Note Hostinger's 5 msg/min cap and that Postfix is throttled below it.
- **docs/ARCHITECTURE.md** — "Transactional email" subsection: enqueue-in-transaction → outbox → worker → local Postfix → direct-to-MX; retry/backoff and suppression rules; unsubscribe applies to the digest only; `lixto status` email block; escape hatch (`relayhost` on 587/465) if the IP's reputation proves unworkable.
- **docs/DATA_MODEL.md** — `email_messages` and `email_suppressions` tables (columns, statuses, the `dedupe_key` partial unique index).
- **docs/VISION.md** — appendix: move "Email/WhatsApp/push notifications" from *not built* to partially built (email done, WhatsApp/push still open) and add a "Cycle 22 — Transactional email (built)" block.
- **CLAUDE.md** — env table gains the five vars; Dokploy section lists the two new schedules and the `lixto-mail` app.

## Checks (run in order — cheapest first)
1. `grep -q "LIXTO_SMTP_HOST" .env.example && grep -q "LIXTO_APP_URL" web/.env.example`
2. `grep -q "Transactional email" README.md && grep -q "mail.lixto.com.br" README.md`
3. `grep -q "email_suppressions" docs/DATA_MODEL.md && grep -q "Transactional email" docs/ARCHITECTURE.md`
4. `grep -q "Cycle 22" docs/VISION.md && grep -q "email-worker" CLAUDE.md`

## Done when
- Env templates and the four docs match the shipped code, and the README runbook lists the Terraform apply, the DKIM round-trip and the manual PTR change in order.

## Not included
- Running Terraform, creating the Dokploy app/schedules, changing PTR (orchestrator steps after this ticket).
