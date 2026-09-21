---
id: 167
status: todo
model: sonnet
depends_on: [166]
max_attempts: 4
files:
  - web/app/page.tsx
  - web/components/marketing/site-header.tsx
  - web/next.config.ts
  - web/lib/auth.ts
  - web/lib/auth.test.ts
---
## Goal
Cycle-29 reviewer follow-ups that do not block shipping: landing-page render cost, cache variance, duplicate session lookups.

## Context
Not scheduled for the cycle-29 run; pick up after go-live.
1. **(F4)** `/` went from static prerender to dynamic SSR per hit because `Home` reads the session cookie (accepted by PRODUCT.md cycle 29). Evaluate keeping the landing shell static with only the header action pair dynamic. Note: without `cacheComponents`/PPR in `next.config.ts`, a `<Suspense>`-wrapped child that reads `cookies()` still makes the whole route dynamic — this needs a deliberate decision (enable cacheComponents, or resolve the pair client-side from a tiny `/api/session-state` endpoint), not a drop-in change. Write the decision as an ADR before coding.
2. **(F5)** `/` varies by `lixto_session` but responds without `Vary: Cookie`; only `Cache-Control: no-cache` keeps a shared cache from serving the logged-in header to anonymous visitors. Add `Vary: Cookie` for `/` via `headers()` in `next.config.ts`.
3. **(F8)** Wrap `getSession` in React `cache()` so layout + page (`requireSession` / `redirectIfLoggedIn`) share one DB lookup per request; keep `buildSessionByTokenQuery` and its test intact.

## Checks (run in order — cheapest first)
1. `cd web && npm run lint`
2. `cd web && npx tsc --noEmit && npm test`
3. `cd web && npm run build`
4. `curl -sI localhost:3000/ | grep -i '^vary:' | grep -qi cookie`

## Done when
- All four checks green and the ADR for item 1 is merged (or item 1 explicitly declined in the ADR).

## Not included
- Footer "Entrar" link; any behaviour change to redirects.
