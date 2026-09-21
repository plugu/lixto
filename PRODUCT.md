---
mode: production
routing_profile: cloud
parallel_default: sequential
---

# Lixto — Session-aware public pages (cycle 29)

## What / why
The owner clicked **Entrar** on the marketing page and got the login form rendered inside the app chrome (sidebar, top bar, menu). It looked like logged-out visitors could see the menu. They cannot: `Sidebar` and `TopBar` return `null` without a session, and prod `/login` with no cookie returns no nav markup. The owner still had a valid session. Two gaps made a logged-in visitor look logged out:

1. The marketing header (`web/components/marketing/site-header.tsx`) always renders **Entrar** + **Criar conta**, whatever the session state.
2. `/login` and `/signup` never look at the session, so a logged-in visitor gets the form inside `web/app/(app)/layout.tsx`, which does render the chrome because a session exists.

So this is a confusing-state bug, not an auth leak. The fix makes the public pages tell the truth about the session.

Repo facts that shape the work:
- `web/proxy.ts` only checks that the `lixto_session` cookie is present; it cannot validate it (no pg pool there). A stale or empty cookie is common after logout or rejection. Any redirect decided on cookie presence alone would loop `/login` ↔ `/dashboard`. The decision must use `getSession()` (`web/lib/auth.ts`), which validates against the DB and the company approval status.
- `/` must stay reachable for everyone (commit `2554f29` removed the proxy bounce on purpose). Only the header changes.
- `/login` already sanitises `?next=` (must start with `/`, not `//`). The redirect reuses that rule.

## Primary user story
As a logged-in Lixto user who opens lixto.com.br, I see **Ir para o painel** in the header instead of **Entrar**, and if I land on `/login` or `/signup` anyway (bookmark, old email link) I am sent straight to the app instead of being shown a login form wrapped in my own menu.

## Behaviour
- Marketing header, valid session: one primary action **Ir para o painel** → `/dashboard`; **Entrar** and **Criar conta** are not rendered. No session, or a cookie that `getSession()` rejects: today's **Entrar** + **Criar conta**, unchanged.
- `/login` with a valid session: redirect to the sanitised `?next=` when present, else `/dashboard`. `?error=` does not block the redirect.
- `/signup` and `/signup/recebido` with a valid session: redirect to `/dashboard`.
- `/login`, `/signup` with no session or an invalid/stale cookie: render exactly as today. No redirect loop in any cookie state (absent, empty, unknown token, expired, company pending/rejected).
- `/invite/[token]`, `/email/unsubscribe`, `/logout`: unchanged.
- Landing page content, SEO metadata and light-token lock: unchanged. If reading the session makes `/` dynamic, that is accepted; it must not throw or 500 when the DB is unreachable (treat as logged out).

## Out of scope
- Moving auth pages out of the `(app)` route group or restyling them
- Account switching while logged in; "logged in as…" UI on the marketing page
- Validating the session in `proxy.ts`; changing cookie or session lifetime
- Any change to the other marketing CTAs (hero, pricing, footer) beyond the header pair
- Schema, Python or email changes

## Success demo
Done when, logged in on prod, lixto.com.br shows **Ir para o painel** and opening `/login` lands me on `/dashboard`; and in a private window the header shows **Entrar** / **Criar conta** and `/login` shows the bare card with no menu.

1. `cd web && npm run lint && npx tsc --noEmit && npm test && npm run build` green; new tests cover header (session / no session), `/login` redirect (with and without `next`, hostile `next`), `/signup` redirect, and the stale-cookie no-loop case.
2. Dev server :3000: `curl -i -H 'Cookie: lixto_session=devprobe' localhost:3000/login` → 307 `/dashboard`; with `?next=/radar` → 307 `/radar`; with `?next=//evil.com` → 307 `/dashboard`; `-H 'Cookie: lixto_session=garbage'` → 200 form, no nav markup; no cookie → 200 form. the `<header>` element of `/` with devprobe cookie contains "Ir para o painel" and not "Entrar"; without cookie the reverse. (The footer keeps its own "Entrar" link: out of scope, and a logged-in click lands on `/dashboard`.)
