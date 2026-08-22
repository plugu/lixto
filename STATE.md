# STATE — rewrite after every ticket completes; never append. ≤30 lines total.

## Now
cycle 6 (mvp, hosting on plugu-prod01) — 17, 18, 19 done (all 1/3); ticket 20 doing (scripts/seed_open.sh), attempt 1/3, sonnet

## Next → 20 seed script → 21 live Dokploy web (orchestrator, confirm each step) → 22 cli app + schedule → final diff review (approval 2/2)

## Decisions
- execution: sequential in place (user choice, cycle 6)
- two Dokploy apps in project `plataforma-licitante`: `web` (domain, Dockerfile web/) + `cli` (no domain, Dockerfile.cli, `sleep infinity`); schedule type `application` execs `plic sync incremental` 3×/day 06/13/20 America/Sao_Paulo
- shared-infra Postgres (postgresId saIpnX_itd9MEJd5zSFWN); provision via vps-infra provision-db.sh; seed only open/future rows via scripts/seed_open.sh through SSH tunnel to plugu-prod01
- GitHub: alexazevedo/plataforma-licitante (private, to create in 21); Dokploy githubId PSIlIbDgqneh8skKGdnix; deploy.yml from vps-infra template + web/** paths filter
- site public, no auth; agents not deployed (no OpenAI key on VPS)
- cycle 4 work still uncommitted (agents, migration 006, tickets 13–15) — must be committed before repo push in ticket 21; cycle 5 committed dc54185
- PRODUCT.md on disk was replaced by a cycle-7 spec (multi-tenant) mid-run by another session; cycle 6 implementers get scratchpad `PRODUCT.cycle6.md` instead. Backups cycle 4/5/6 in session scratchpad
- probe pkill `next-server` kills dev server — restart after runs

## Blockers
- none
