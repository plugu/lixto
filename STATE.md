# STATE — rewrite after every ticket completes; never append. ≤30 lines total.

## Now
cycle 7 (mvp, multi-tenant) — 23 done (1/3, 9cc4f08), 24 done (2/3, 7f8572e); 25/26/27/28 doing in parallel (sonnet, attempt 1/3) in worktrees `../plic-t25..t28`, branches `cycle7-t25..t28` off `cycle7-tenant`; ports 3101–3104
- main advanced to 72b46ed (ticket 20 seed script, other session) — rebase/merge cycle7-tenant onto it before final merge
- `npm run lint` red on pre-existing multi-select.tsx / db.ts errors → tickets lint scoped to own files
- env: migrate = `uv run plic db init`; dev DB on :5433 shared w/ main checkout; psql via `docker exec plataforma-licitante-db-1`; run `npx next typegen` before tsc in fresh worktree

## Next
24 (opus) after 23; then 25–28 parallel in sub-worktrees off 24; 29 last; merge to main; mvp final diff review (approval 2/2)

## Decisions
- execution: hybrid — 23→24 sequential in feature worktree; 25/26/27/28 parallel (disjoint files), merged one by one; 29 sequential
- main committed before cycle: 2f11aa9 (cycles 4–6 work), b3f9e25 (plan)
- no new npm deps: Node crypto scrypt + DB `sessao` table; cookie `plic_session`; `proxy.ts` checks cookie presence only
- empresa_id always from session, never from request
- invites = on-screen link, no email; BrasilAPI via server action, not API route
- cycle 6 hosting: ticket 20 was mid-flight (seed script) — status per tickets/20; tickets 17–22 untouched this cycle
- carried over: agents read `company_profile.md`; OpenAI Responses API; `pkill next-server` kills dev server

## Blockers
- none
