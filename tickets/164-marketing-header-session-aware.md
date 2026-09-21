---
id: 164
status: done
model: sonnet
depends_on: [163]
max_attempts: 4
files:
  - web/components/marketing/header-actions.ts
  - web/components/marketing/header-actions.test.ts
  - web/components/marketing/site-header.tsx
  - web/app/page.tsx
---
## Goal
The marketing page header tells the truth about the session: a visitor with a valid session sees one action, **Ir para o painel** → `/dashboard`; everyone else sees today's **Entrar** + **Criar conta**.

## Context
`web/components/marketing/site-header.tsx` hard-codes the two links (lines 38–51), so a logged-in owner reads "Entrar" and assumes they are logged out. `/` must stay public and reachable for everyone (`web/proxy.ts` lets it through on purpose; do not touch the proxy). Ticket 163 added `getOptionalSession()` in `web/lib/public-pages.ts`: validated session or `null`, and `null` (never a throw) when the DB is unreachable — so the landing page cannot 500 because of this feature.

Work:
1. `web/components/marketing/header-actions.ts` (pure, no React/Next imports): `export type HeaderAction = { href: string; label: string; variant: "link" | "primary" }` and `export function headerActions(loggedIn: boolean): HeaderAction[]`. `true` → `[{ href: "/dashboard", label: "Ir para o painel", variant: "primary" }]`. `false` → `[{ href: "/login", label: "Entrar", variant: "link" }, { href: "/signup", label: "Criar conta", variant: "primary" }]`.
2. `site-header.tsx`: signature `SiteHeader({ loggedIn }: { loggedIn: boolean })`; render the right-hand `<div>` by mapping `headerActions(loggedIn)`. Keep the two existing class strings byte-for-byte: `variant: "link"` uses the current "Entrar" classes, `variant: "primary"` uses the current "Criar conta" mint-pill classes. Nothing else in the header changes. Stays a server component (no `"use client"`).
3. `web/app/page.tsx`: `Home` becomes `async`; `const session = await getOptionalSession();` then `<SiteHeader loggedIn={session !== null} />`. Pass only the boolean — no user/company data reaches the marketing tree. Reading cookies makes `/` dynamic; that is accepted by PRODUCT.md. `metadata`, `theme-light-lock`, fonts and every other section stay untouched.
4. `header-actions.test.ts`: logged in → exactly one action, href `/dashboard`, label `Ir para o painel`, and no action with href `/login` or `/signup`; logged out → exactly the two actions in order, hrefs `/login`, `/signup`.
5. Grep before finishing: `SiteHeader` has exactly one call site (`web/app/page.tsx`); if another exists, pass `loggedIn` there the same way.

Runtime probe preconditions: same as 163 (DB on :5433, dev server on :3000, `lixto_session=devprobe` valid).

## Checks (run in order — cheapest first)
1. `cd web && npm run lint`
2. `cd web && npx vitest run components/marketing/header-actions.test.ts`
3. `cd web && npx tsc --noEmit`
4. `cd web && npm test`
5. `cd web && npm run build`
6. `out=$(curl -s -b lixto_session=devprobe localhost:3000/ | tr '\n' ' ' | grep -oE '<header.*</header>' | head -1); echo "$out" | grep -q 'Ir para o painel' && ! echo "$out" | grep -q '>Entrar<'`
7. `for c in '' '-b lixto_session=garbage'; do out=$(curl -s $c localhost:3000/); echo "$out" | grep -q '>Entrar<' || exit 1; echo "$out" | grep -q 'Criar conta' || exit 1; echo "$out" | grep -q 'Ir para o painel' && exit 1; done; true`
8. `curl -s -o /dev/null -w '%{http_code}' -b lixto_session=devprobe localhost:3000/ | grep -qx 200`

## Done when
- All eight checks green; `/` still returns 200 (never a redirect) in every cookie state.

## Not included
- Hero, pricing, FAQ or footer CTAs; any copy other than the header pair.
- Showing the user's name/company/avatar on the marketing page.
- `web/proxy.ts`, SEO metadata, dark-mode/light-lock tokens, caching/ISR tuning for `/`.

## Orchestrator note (2026-09-21)
Check 6 originally grepped the whole page for `>Entrar<`; `site-footer.tsx` carries its own "Entrar" link, which PRODUCT.md puts out of scope (and which now lands logged-in visitors on /dashboard via ticket 163). Check scoped to the `<header>` element — an authoring fix, not a lowered bar. Re-run by the orchestrator: logged in → header has only "Ir para o painel" → /dashboard; no cookie and garbage cookie → "Entrar" + "Criar conta"; `/` = 200 in all three states.
