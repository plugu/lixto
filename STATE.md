# STATE — rewrite after every ticket completes; never append. ≤30 lines total.

## Now
- Cycle 28 (gated signup + superadmin, **production**): code complete on `main` (e7f8206..HEAD), NOT pushed. Tickets 153–161 done, all attempt 1. Reviewer pass done (no blockers; gating findings fixed in 161). Awaiting approval 3/3 → push → Dokploy autoDeploy → prod grant.
- Verified 2026-09-18: `npm test` 750/750, `pytest` 504/504, lint 0 errors, tsc + build clean; live probes on :3000 (404 for non-superadmin on /admin/companies, Pendentes tab for superadmin).

## Next
- Push → autoDeploy `lixto-web` + `lixto-cli` (migration 007 applies on `lixto-cli` deploy via `lixto db init`).
- Prod: `docker exec <lixto-cli> lixto users grant-superadmin alxazevedo@gmail.com`; verify Administração → Empresas; end-to-end demo with a fresh CNPJ.
- 162 review-followups (pagination, retire `welcome` template + migration 008, dialog instead of confirm(), CLI already-granted) — after go-live.
- Restart the other project's DB: `docker start plugu-clientes-db-1` (stopped for this run; lixto compose DB holds :5433 meanwhile).
- Older follow-ups: DMARC tighten; CNAE cleanup; Gemini billing; Radar schedules OFF until LLM provider decision; `analyze-run` cron OFF by decision.

## Decisions
- execution: sequential (in place, on `main`)
- Approval is per company; superadmin = `users.is_superadmin`, CLI-only; `getSession` re-checks approval each request (ADR 003).
- Re-applying a status resends the mail on purpose (superadmin resend).
- `signup_pending_admin` rows carry `companyId: null` (tenant hygiene); the `welcome` template stays defined but unused until 162.
- Dev env: lixto DB via `docker compose` on :5433; no host `psql` → `docker compose exec -T db psql -U lixto -d lixto`; dev server :3000; cookie `lixto_session=devprobe` (user 1, company 1, now `is_superadmin=true`).

## Blockers
- none.
