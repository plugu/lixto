---
id: 54
status: done
model: sonnet
depends_on: []
max_attempts: 3
files:
  - web/app/page.tsx
  - web/components/sidebar.tsx
  - web/components/ui/top-bar.tsx
  - web/proxy.ts
---
## Goal
Collapse the two overview destinations ("/" hero page + "/painel" dashboard) into one: "/" redirects to "/painel", sidebar shows a single "Painel" nav item.

## Context
`sidebar.tsx` exports `NAV_ITEMS` (consumed by both `Sidebar` and `top-bar.tsx`'s mobile slide-over) — currently `[{href:"/",label:"Visão geral"}, {href:"/painel",...}, {href:"/licitacoes",...}]`. Drop the `/` entry, keep the other two, order unchanged. The `isActive()` special-case for `href === "/"` can stay (harmless dead branch) — do not refactor it, out of scope.

`page.tsx` (current root route) renders the hero search UI (`SearchBox`, `CHIPS`, stat tiles) — this content is being retired here, not moved. Replace the whole file with a server-side `redirect("/painel")` (from `next/navigation`), matching the `dynamic = "force-dynamic"` export style used elsewhere in `app/`.

`sidebar.tsx`'s logo `<Link href="/">` and `top-bar.tsx`'s logo `<Link href="/">` (mobile header) should point at `/painel` directly, so clicking the logo doesn't take the extra redirect hop.

Leave `not-found.tsx`'s `href="/"` and the auth-flow default-redirect-to-`/`-after-login as is — both still resolve correctly through the new redirect, changing them is out of scope.

## Amendment (attempt 2 — ticket was underspecified)
`page.tsx`'s `redirect("/painel")` is now confirmed working code but check 4 still fails: `app/loading.tsx` is a sibling of `page.tsx`, so Next wraps the root route in a Suspense boundary. Per Next 16's streaming behavior, `redirect()` called from a Suspense-wrapped page degrades to a `200 OK` + client-side `<meta>` refresh instead of a real HTTP `Location` header — curl never sees a redirect. Fix: add the redirect to `web/proxy.ts` instead (runs pre-render, immune to Suspense) — at the top of `proxy(request)`, before the `PUBLIC_PREFIXES` check, add: if `pathname === "/"`, clone `request.nextUrl`, set `.pathname = "/painel"`, return `NextResponse.redirect(url)`. Leave `page.tsx`'s own `redirect("/painel")` in place as defense-in-depth (harmless, just never hit in normal flow now). Do not touch `PUBLIC_PREFIXES`, the session-cookie check, or `loading.tsx`.

## Checks (run in order — cheapest first)
1. `cd web && npx tsc --noEmit`
2. `cd web && npx vitest run`
3. `cd web && npm run build`
4. `cd web && (npm run start -- -p 3101 &) && sleep 5 && curl -sI localhost:3101/ | grep -qi 'location: /painel' && pkill -f "next-server"`

## Done when
- Sidebar (desktop) and slide-over (mobile) show exactly one overview item: "Painel" — no separate "Visão geral" entry.
- Hitting `/` returns a redirect to `/painel`.

## Not included
- Redesigning Painel's content, heading, or layout.
- Reworking `isActive()`, `not-found.tsx`, or the post-login redirect target.
- Preserving or relocating the retired hero search UI (`SearchBox`/`CHIPS`) — it is deleted with `page.tsx`, not migrated.
