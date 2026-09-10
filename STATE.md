# STATE — rewrite after every ticket completes; never append. ≤30 lines total.

## Now
- Cycle 27 (App fluidity, **mvp**, `web/`): DEPLOYED `a11a6fe` 2026-09-10 20:29 UTC (Dokploy autoDeploy, done). Tickets 140–152 all attempt 1. Prod smoke: /, /login 200; auth redirects OK; theme script present. Next cycle: TBD.
- Verified 2026-09-09: lint 0 errors, `npm test` 687/687, build green; live walkthrough on :3000 (dashboard streaming, PillTabs, live filters `?state=SP`, ⌘K results, dismiss→toast→Desfazer restore, dark/light toggle) all OK.

## Next
- Logged-in prod walkthrough still to do by the user (skeletons, ⌘K, filters, dark mode).
- Known/harmless: in a hidden tab the View Transitions `ready` promise rejects (`InvalidStateError`) on each nav — seen only via automation; invisible tabs skip transitions by spec.
- Small follow-ups (not ticketed): Escape should close `details` filter popovers; dev `.env.local` embedding model 404s on Gemini (`text-embedding-3-small`) so local semantic search degrades to keyword.
- Cycle 26 CLOSED `ccfb5a7` (ML facets all NO-GO). Radar schedules OFF until LLM provider decision; `analyze-run` cron OFF by decision.
- Older follow-ups: DMARC tighten; CNAE cleanup; Gemini billing.

## Decisions
- execution: sequential (in place, on `main`)
- Cycle 27: URL contracts frozen; nuqs only for pill tabs; repeated-key filters via `lib/procurement-url.ts` / `lib/radar-url.ts` with client twin parsers + equivalence tests (client code cannot import `lib/*-queries.ts`); view transitions via `next-view-transitions@0.3.5`; no worker/migration changes; vitest node-only → UI verified by lint/build/curl with `lixto_session=devprobe`.
- Orchestrator edits outside tickets: `notFound()` in procurement detail (141 probe), ghost "Desfazer" kept on radar detail (147 regression).
- VPS access: Tailscale SSH check-mode — user runs `! ssh plugu-prod01 true`; prod PG via `docker exec $(docker ps -qf name=pg-shared) psql -U shared -d lixto`.
- Dev probe fixtures (gitignored / dev DB): `web/.env.local` internal token + Gemini key; cookie `devprobe` (extend with `UPDATE sessions SET expires_at=… WHERE token_hash=encode(sha256('devprobe'::bytea),'hex')`); company 1 terms `{limpeza}`.

## Blockers
- none.
