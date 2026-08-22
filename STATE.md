# STATE — rewrite after every ticket completes; never append. ≤30 lines total.

## Now
cycle 7 (mvp, multi-tenant) — tickets 23–29 all done, all attempts 1/3 except 24 (2/3). Branch `cycle7-tenant` in worktree `../plataforma-licitante-cycle7`, main (72b46ed) merged in. Integrated checks: tsc ok, vitest 312/312, build ok, Docker image builds.

## Next
mvp final diff review with user (approval 2/2) → merge `cycle7-tenant` into main → apply `007_tenant.sql` on VPS (`uv run plic db init`) + mount `/app/uploads` volume in Dokploy per docs/TENANT.md → remove worktree

## Decisions
- execution: hybrid — 23→24 sequential; 25–28 parallel in sub-worktrees (cleaned up); 29 sequential
- no new npm deps: Node crypto scrypt + DB `sessao` table; cookie `plic_session`; `proxy.ts` checks cookie presence only, pages call `requireSession()`
- empresa_id always from session, never from request; `tenant-isolation.test.ts` sweeps every builder
- invites = on-screen link, no email; BrasilAPI via server action with custom User-Agent (default Node UA → 403)
- env: migrate = `uv run plic db init`; psql via `docker exec plataforma-licitante-db-1`; `npx next typegen` before tsc after route changes; never symlink node_modules across worktrees (Turbopack rejects)
- `npm run lint` red on pre-existing multi-select.tsx / db.ts errors — not fixed this cycle
- cycle 6 hosting (tickets 17–22): 20 landed on main from another session; 21–22 status per ticket files

## Blockers
- none
