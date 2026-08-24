---
id: 46
status: done
model: haiku
depends_on: [41, 42, 43, 44, 45]
max_attempts: 3
files:
  - web/app/login/page.tsx
  - web/app/signup/page.tsx
  - web/app/convite/[token]/page.tsx
  - web/components/signup-form.tsx
---
## Goal
Auth pages fit 375px, plus a final no-horizontal-scroll sweep across all routes.

## Context
Auth pages are already centered `max-w-sm` columns: `login/page.tsx:20`, `signup/page.tsx:6`, `convite/[token]/page.tsx:39`. At 375px `max-w-sm` (384px) exceeds viewport — shell padding (ticket 41) constrains it, but verify each page: inputs full-width, no fixed-width children, buttons ≥40px tall. `signup-form.tsx` is multi-section — confirm sections are single-column at phone width and any grid uses a `sm:`/`lg:` prefix.

Sweep (verification, minimal diffs): for every route (/, /licitacoes, /licitacao/[id], /painel, /empresa, /empresa/usuarios, /empresa/documentos, /login, /signup, /convite/[token]) confirm no element forces page-level horizontal scroll at 375px — look for fixed widths (`w-[...px]`, `min-w-` without a scroll container, missing `min-w-0` on flex children). Fix only page-level overflow leaks; do not restyle other tickets' work.

## Checks (run in order — cheapest first)
1. `cd web && npm run lint`
2. `cd web && npm run build`
3. `cd web && npm run test`

## Done when
- At 375px: login, signup, convite render fully inside viewport and forms are usable.
- No route exhibits page-level horizontal scroll at 375px.

## Not included
- Auth logic, session handling, redirects. Visual restyling. New components.
