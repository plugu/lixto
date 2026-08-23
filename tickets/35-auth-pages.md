---
id: 35
status: todo
model: sonnet
depends_on: [31]
max_attempts: 3
files:
  - web/app/login/page.tsx
  - web/app/signup/page.tsx
  - web/app/convite/[token]/page.tsx
  - web/components/signup-form.tsx
---
## Goal
Login, signup and convite pages become centered Perplexity-style forms on the calm canvas, using the kit; behavior and server actions unchanged.

## Context
Read `docs/design/cycle8-direction.md` and `web/components/ui/*.tsx` first. These routes are public (`proxy.ts` PUBLIC_PREFIXES) and the sidebar returns null without session, so they render full-bleed.

Today: `login/page.tsx` (82 lines, inline form → `./actions.loginAction`, card `mx-auto mt-24 max-w-sm`); `signup/page.tsx` (24) wraps `signup-form.tsx` (521 lines, client, multi-step, CNPJ lookup via `lookupAction`, `useActionState`); `convite/[token]/page.tsx` (140, inline form → `aceitarConviteAction`, reads `getConvite`).

New: shared visual pattern (no shared component needed — keep each page self-contained): wordmark centered top (`font-display`), form column `max-w-sm` vertically centered, `Field`/`Input`/`Button variant="primary" size="md"` full-width, helper links as ghost `LinkButton`. Signup multi-step: step indicator as three `StatusDot`s (active = accent), CNPJ lookup result shown in a tone-separated `Section` (no border), CNAE list as pills. Error/success text uses tokens `warn`/`ok`. Do not change field names, actions, validation, or step logic — only markup/classes.

## Checks (run in order — cheapest first)
1. `cd web && npx tsc --noEmit`
2. `cd web && npx vitest run`
3. `cd web && npm run build`
4. `cd web && (npm run start -- -p 3100 &) && sleep 5 && curl -s localhost:3100/login | grep -q 'name="email"' && curl -s localhost:3100/signup | grep -qi 'cnpj' && pkill -f "next-server"`

## Done when
- Three public pages share the new look; every form input name/action identical to before.

## Not included
- No auth logic, no new routes, no password-reset.
