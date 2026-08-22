# STATE — rewrite after every ticket completes; never append. ≤30 lines total.

## Now
cycle 6 (mvp, hosting) — tickets 17–22 all done; awaiting final diff review (approval 2/2). Cycle 7 (multi-tenant, tickets 23–29) planned by another session, not started.

## Next
user reviews cycle 6 diff → then cycle 7 `/forge:run` (worktree required per its PRODUCT.md)

## Decisions
- LIVE: https://plataforma-licitante.site.plugu.solutions — Dokploy project `plataforma-licitante` (projectId 6zlcPIz8zvmdi25gGoqlo, env GM50KTsFbvV5xrm-SFipE); app `web` k62Z-MLD6O005blue5dnc (web/Dockerfile, ctx web, watch web/**); app `cli` 1GYp7T_4WU3zT0dcs01mz (Dockerfile.cli, idle `sleep infinity`, watch src/** migrations/** pyproject uv.lock Dockerfile.cli)
- schedule `sync-incremental` M_rVXMwieHeg-KQVaJtck on cli app: `0 6,13,20 * * *` America/Sao_Paulo → `plic sync incremental --max-detalhes 2000`; first manual run OK (rows 22864→23264, watermarks advanced)
- DB: shared-infra pg18, role `plataforma-licitante_app`, db `plataforma-licitante_db`, host `pg-shared-nyfajl:5432` (no external port). Seeded 2026-08-22 with open/future only. Creds live only in Dokploy app env (both apps). Access from laptop: ssh plugu-prod01 (Tailscale SSH check-mode auth in browser; user in docker group) + socat bridge `docker run --network dokploy-network -p 127.0.0.1:15432:5432 alpine/socat TCP-LISTEN:5432,fork TCP:pg-shared-nyfajl:5432` + `ssh -L 15432:127.0.0.1:15432`
- GitHub: git@github.com:alexazevedo/plataforma-licitante (private); origin uses SSH (gh token lacks `workflow` scope for HTTPS push). Secret DOKPLOY_DEPLOY_WEBHOOK set; Actions `Deploy` green on web/** pushes; Dokploy GitHub App (dokploy-plugu-prod01) also auto-deploys both apps on push
- execution: sequential in place (cycle 6)
- site public, no auth; agents not deployed (no OpenAI key on VPS)
- no local psql: use `PSQL="docker compose exec -T db psql"` with seed_open.sh
- PRODUCT.md on disk = cycle 7 spec; cycle 6 spec kept in session scratchpad only
- probe pkill `next-server` kills dev server — restart after runs

## Blockers
- none
