# STATE — rewrite after every ticket completes; never append. ≤30 lines total.

## Now
cycle 7 (mvp, multi-tenant) — ticket 23 doing (sonnet, attempt 1/3) in worktree `../plataforma-licitante-cycle7` branch `cycle7-tenant`

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
