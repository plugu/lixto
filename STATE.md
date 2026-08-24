# STATE — rewrite after every ticket completes; never append. ≤30 lines total.

## Now
- Ticket 54 (nav-consolidate-painel) done. Checks green (tsc, 330 web tests, build, real 307 runtime probe). Awaiting mvp gate 2/2.

## Next
- gate 2/2: user reviews diff → close cycle 12.

## Decisions
- execution: sequential. Cycle 12: nav consolidation (Painel absorbs Visão Geral), mvp.
- attempt 1: `page.tsx` → `redirect("/painel")`; found this degrades to client meta-refresh (200, no Location header) because `app/loading.tsx` wraps root in a Suspense boundary — Next 16 streaming quirk. Ticket amended.
- attempt 2: real redirect moved to `web/proxy.ts` (pre-render, immune to Suspense) — `/` → 307 → `/painel` unconditionally, before the `PUBLIC_PREFIXES`/auth gate. `page.tsx` redirect kept as harmless defense-in-depth.
- logo links (sidebar + mobile top-bar) point at `/painel` directly.
- not-found.tsx `href="/"` and post-login default redirect target: left as-is, resolve fine through the new proxy redirect.

## Blockers
- none
