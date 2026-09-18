---
id: 155
status: todo
model: sonnet
depends_on: [153]
max_attempts: 4
files:
  - web/lib/email/templates.ts
  - web/lib/email/templates.test.ts
  - web/lib/email/outbox.ts
---
## Goal
Four new transactional templates render through `renderTemplate`: `signup_received`, `signup_pending_admin`, `signup_approved`, `signup_rejected`.

## Context
`web/lib/email/templates.ts` holds `TemplatePayloads` (typed payload per template), one `renderX` function per template built from `paragraph`, `renderButton`, `renderLayout`, `escapeHtml`, and the `renderTemplate` switch. `web/lib/email/outbox.ts` declares the `EmailTemplate` union that must match the DB CHECK from migration 007. `sender.ts` needs no change (it only special-cases `daily_digest`). Copy the `welcome` shape: subject, html via `renderLayout` with `preheader`, plain `text` variant, all payload strings HTML-escaped in html and raw in text. Portuguese copy, "Lixto" as sender voice, no marketing fluff.

Payloads and copy:
- `signup_received: { userName; companyName }` — subject `Recebemos o cadastro da ${companyName}`; body: thanks, "estamos avaliando os dados da sua empresa", you will get another email when access is released; no button.
- `signup_pending_admin: { companyName; taxId; adminName; adminEmail; adminUrl }` — subject `Nova empresa aguardando aprovação: ${companyName}`; body lists company, CNPJ (format `00.000.000/0000-00` from the 14 digits), admin name + email; button `Revisar cadastro` → `adminUrl`.
- `signup_approved: { userName; companyName; loginUrl }` — subject `Acesso liberado: ${companyName} no Lixto`; body: access granted, button `Entrar no Lixto` → `loginUrl`.
- `signup_rejected: { userName; companyName; reason: string | null }` — subject `Cadastro da ${companyName} não aprovado`; body: not approved at this time; when `reason` is non-empty add a paragraph `Motivo: ${reason}`; invite to reply to this email for questions; no button.

Tests in `templates.test.ts` (existing style): subject + CTA/href for each; `signup_rejected` with and without reason; CNPJ formatting in `signup_pending_admin`; XSS escaping for one of the new payload fields (html escaped, text raw).

## Checks (run in order — cheapest first)
1. `cd web && npm run lint`
2. `cd web && npx vitest run lib/email/templates.test.ts lib/email/sender.test.ts lib/email/outbox.test.ts`
3. `cd web && npx tsc --noEmit`

## Done when
- `renderTemplate("signup_rejected", { userName: "Ana", companyName: "ACME", reason: null })` returns subject/html/text; `EmailTemplate` includes the four names and the file type-checks.

## Not included
- Enqueueing the mails anywhere (156, 158); changes to `sender.ts` or `layout.ts`.
