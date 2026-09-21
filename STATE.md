# STATE — rewrite after every ticket completes; never append. ≤30 lines total.

## Now
- Cycle 29 (session-aware public pages, **production**): 163–166 done, reviewer pass clean, user approved 3 of 3 on 2026-09-21; committed + pushed (autoDeploy lixto-web). Verified pre-push: lint 0 errors, tsc clean, vitest 775/775, build green, live probes.
- Cycle 28 (gated signup + superadmin): DEPLOYED `0ce4bba` 2026-09-19. Remaining: run Dokploy schedule `grant-superadmin` from the UI.

## Next
- Confirm lixto-web deploy + prod probe. Then 167 cycle-29 follow-ups (static shell ADR for `/`, `Vary: Cookie`, React `cache()` on `getSession`).
- Prod: run `grant-superadmin`, verify Administração → Empresas; end-to-end demo with a fresh CNPJ.
- 162 review-followups (pagination, retire `welcome` template + migration 008, dialog instead of confirm(), CLI already-granted).
- Restart the other project's DB: `docker start plugu-clientes-db-1`.
- Older follow-ups: DMARC tighten; CNAE cleanup; Gemini billing; Radar schedules OFF until LLM provider decision; `analyze-run` cron OFF by decision.

## Decisions
- Execution: sequential (in place, on `main`); cycle 29 is a linear chain.
- Public pages trust `getSession()`, not cookie presence; DB outage = logged out.
- Same-origin redirect targets go through `safeNextPath` (`web/lib/safe-next.ts`); rejects `//` and `/\`.
- Approval is per company; superadmin = `users.is_superadmin`, CLI-only; `getSession` re-checks approval each request (ADR 003).
- Dev env: lixto DB via `docker compose` on :5433; dev server :3000; cookie `lixto_session=devprobe` (user 1, company 1, `is_superadmin=true`).

## Blockers
- None.
