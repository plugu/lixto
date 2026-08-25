---
id: 60
status: done
model: sonnet
depends_on: []
max_attempts: 3
files:
  - web/proxy.ts
  - web/app/layout.tsx
  - web/app/page.tsx
  - web/app/(app)/layout.tsx
  - web/app/(app)/** (moved route dirs)
  - web/app/not-found.tsx
  - web/app/error.tsx
  - web/app/loading.tsx
---
## Goal
Make `/` a public marketing route with a bare layout, moving all existing pages into an `(app)` route group that keeps the current chrome.

## Context
Today `web/app/page.tsx` redirects `/` → `/painel`, and `web/proxy.ts` (line ~21) does the same before auth checks. The root layout (`web/app/layout.tsx`) hardwires `TopBar` + `Sidebar` + a `max-w-5xl` padded `<main>` around every page; both chrome components already `return null` without a session. Restructure: root layout keeps only `<html>`/`<body>`, Inter font, `globals.css`, and metadata. New `web/app/(app)/layout.tsx` holds `getSession()`, TopBar, Sidebar, and the `<main>` container exactly as today. `git mv` these dirs into `web/app/(app)/`: `convite`, `empresa`, `licitacao`, `licitacoes`, `login`, `logout`, `painel`, `signup` (URLs unchanged — route groups don't affect paths). `error.tsx`/`loading.tsx`/`not-found.tsx` stay at root; give them a minimal centered wrapper since they lose the container. In `proxy.ts`: remove the unconditional `/` → `/painel` redirect; `/` is public for logged-out visitors, but a request to `/` **with** a valid session cookie still redirects to `/painel`. New `web/app/page.tsx`: placeholder full-bleed page rendering the text "Liciplus" and a link to `/signup` (ticket 61 replaces it).

## Checks (run in order — cheapest first)
1. `cd web && npm run lint`
2. `cd web && npm run build`
3. `cd web && npm run test`
4. `cd web && (PORT=3111 npm run start &) && sleep 4 && curl -s localhost:3111/ | grep -qi liciplus && curl -s -o /dev/null -w '%{redirect_url}' localhost:3111/painel | grep -q /login; kill %1 2>/dev/null; true`

## Done when
- Logged-out visit to `/` renders the placeholder (no sidebar, no container width cap); `/painel` still bounces to `/login`.
- Logged-in visit to `/` still redirects to `/painel`; all existing routes serve at unchanged URLs.

## Not included
- Any real landing content or design (ticket 61).
- Changing login/signup page internals, metadata/brand strings, or favicon.
