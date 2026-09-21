---
id: 165
status: done
model: haiku
depends_on: [164]
max_attempts: 4
files:
  - docs/ARCHITECTURE.md
  - web/AGENTS.md
  - CLAUDE.md
  - STATE.md
---
## Goal
Record the cycle-29 rule so the next agent does not reintroduce the bug: public pages decide on a **validated** session, never on cookie presence.

## Context
Cycle 29 (tickets 163–164) added `web/lib/safe-next.ts` (`safeNextPath`, `DEFAULT_LANDING`), `web/lib/public-pages.ts` (`getOptionalSession`, `redirectIfLoggedIn`) and `web/components/marketing/header-actions.ts`. `/login`, `/signup`, `/signup/recebido` redirect logged-in visitors; the marketing header shows "Ir para o painel" when logged in. `web/proxy.ts` is unchanged and still checks cookie presence only.

Work:
1. `docs/ARCHITECTURE.md`, section "Web app interaction model": add a short subsection **Session-aware public pages** (≤8 lines): the two helpers, which pages call them, why `proxy.ts` cannot make this decision (no pg pool; stale cookie would loop `/login` ↔ `/dashboard`), DB outage = logged out, `/` is dynamic because it reads the cookie; only the **header** pair is session-aware — the footer's "Entrar" link is unchanged on purpose (a logged-in click lands on /dashboard via the `/login` redirect).
2. `web/AGENTS.md`: one rule — "Same-origin redirect targets go through `safeNextPath` (`lib/safe-next.ts`); never hand-roll `startsWith('/')`. Public pages that branch on login state use `getOptionalSession` / `redirectIfLoggedIn` (`lib/public-pages.ts`)."
3. `CLAUDE.md`, "Key Code Locations" table: one row after "Session & auth": `| Public-page session helpers | \`web/lib/public-pages.ts\`, \`web/lib/safe-next.ts\` (logged-in redirect off /login & /signup; safe \`?next=\`); \`web/components/marketing/header-actions.ts\` |`.
4. `STATE.md`: rewrite (never append, ≤30 lines): Now = cycle 29 tickets 163–165 done, awaiting reviewer pass/deploy; keep the still-open cycle-28 items under Next (`grant-superadmin` schedule run, ticket 162 follow-ups, `docker start plugu-clientes-db-1`, older follow-ups) and the Decisions/dev-env lines that still hold; add decision "public pages trust `getSession()`, not cookie presence".

## Checks (run in order — cheapest first)
1. `grep -q 'Session-aware public pages' docs/ARCHITECTURE.md`
2. `grep -q 'safeNextPath' web/AGENTS.md && grep -q 'public-pages.ts' CLAUDE.md`
3. `test $(wc -l < STATE.md) -le 30 && grep -q '163' STATE.md && grep -q 'grant-superadmin' STATE.md`
4. `cd web && npm run lint`

## Done when
- All four checks green.

## Not included
- README, VISION.md, DATA_MODEL.md, PRODUCT.md edits; any code change.
