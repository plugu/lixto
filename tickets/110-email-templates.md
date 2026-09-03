---
id: 110
status: done
model: sonnet
depends_on: []
max_attempts: 4
files:
  - web/lib/email/templates.ts
  - web/lib/email/templates.test.ts
  - web/lib/email/layout.ts
---
## Goal
Four Portuguese templates render to `{ subject, html, text }` from typed payloads, on one shared layout.

## Context

Pure functions, no DB, no network — the outbox stores `payload JSONB`, the worker renders at send time. Product: `welcome`, `invite`, `password_reset`, `daily_digest`.

`layout.ts`: `renderLayout({ title, bodyHtml, footerHtml? })` → full HTML document. Table-based, inline styles only (no external CSS/images — many clients strip them), max-width 600px, system font stack, Lixto wordmark as text, preheader span. Colors: ink `#111827`, muted `#6b7280`, accent `#2563eb`, border `#e5e7eb`. Also `renderButton(href, label)` (table-cell "bulletproof" button) and `escapeHtml(s)`.

`templates.ts`:
```ts
export type TemplatePayloads = {
  welcome: { userName: string; companyName: string; appUrl: string };
  invite: { inviterName: string; companyName: string; acceptUrl: string; expiresAt: string };
  password_reset: { userName: string; resetUrl: string; expiresMinutes: number };
  daily_digest: {
    companyName: string; appUrl: string; unsubscribeUrl: string;
    newCount: number; matchedCount: number; attentionCount: number;
    attention: Array<{ sourceId: string; description: string; agency: string | null;
                       state: string | null; score: number; closesAt: string | null; url: string }>;
  };
};
export type RenderedEmail = { subject: string; html: string; text: string };
export function renderTemplate<T extends keyof TemplatePayloads>(t: T, p: TemplatePayloads[T]): RenderedEmail;
```
Subjects (pt-BR): welcome `Bem-vindo ao Lixto, {userName}`; invite `{inviterName} convidou você para o Lixto`; password_reset `Redefinição de senha — Lixto`; daily_digest `{attentionCount} oportunidade(s) merecem sua atenção hoje` (0 attention but >0 matched → `Resumo Lixto: {matchedCount} licitações compatíveis hoje`).
Every template renders a plain-text alternative (same content, links spelled out) — text/plain is required for spam scoring. Digest lists up to 5 attention cards (description truncated 120 chars, agency, UF, score, closing date) plus a "ver todas" link, and a footer line `Não quero mais receber este resumo` → `unsubscribeUrl`. Only `daily_digest` renders the unsubscribe footer; transactional mail must not.
All interpolated values pass through `escapeHtml`; `renderTemplate` throws on an unknown template name.

Tests: snapshot-free assertions — subject strings per template; `html` contains the escaped company name and the CTA href; a payload with `"<script>"` in `userName` appears escaped in html and raw in text; digest with `attention: []` uses the fallback subject and renders no cards; digest html contains `unsubscribeUrl`, welcome/invite/password_reset do not; every render returns non-empty `text`.

## Checks (run in order — cheapest first)
1. `cd web && npm run lint`
2. `cd web && npx tsc --noEmit`
3. `cd web && npx vitest run lib/email/templates.test.ts`
4. `cd web && npm test`

## Done when
- `renderTemplate("daily_digest", …)` returns a pt-BR subject reflecting `attentionCount`, HTML with ≤5 cards and the unsubscribe link, and a non-empty text part; XSS in any payload field is escaped.

## Not included
- Sending (ticket 111), enqueueing (108/112), the unsubscribe route itself (112).
