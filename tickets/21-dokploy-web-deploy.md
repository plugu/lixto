---
id: 21
status: todo
model: orchestrator
depends_on: [17, 19, 20]
max_attempts: 3
files: []
---
## Goal
Web app live at `https://plataforma-licitante.site.plugu.solutions` on Dokploy, backed by the shared-infra Postgres (provisioned, migrated, seeded), redeploying on every push to `main`.

## Context
**Executed by the orchestrator in-session via the `dokploy` MCP + `gh` — not a subagent.** Every live-mutating step below is announced and confirmed with the user first (skill `deploying-plugu-projects`).

Known ids: GitHub provider `githubId=PSIlIbDgqneh8skKGdnix` (dokploy-alexazevedo). GitHub user `alexazevedo`. VPS tailnet host `plugu-prod01`. Shared Postgres: Dokploy project `shared-infra`, `postgresId=saIpnX_itd9MEJd5zSFWN` (admin URL from its env vars; never persisted).

Steps:
1. **GitHub repo** — `gh repo create alexazevedo/plataforma-licitante --private --source=. --remote=origin --push` (commit pending work first; user decides what to commit).
2. **Provision DB** — `PG_ADMIN_URL=... ~/dev/vps-infra/scripts/provision-db.sh plataforma-licitante` run where it can reach the instance (SSH tunnel `ssh -N -L 15432:localhost:5432 plugu-prod01` if 5432 isn't tailnet-exposed; check `postgres-one` externalPort first). Use `PG_APP_HOST=<shared-infra postgres appName> PG_APP_PORT=5432` so the printed URL works from Dokploy containers. Capture `DATABASE_URL` once.
3. **Migrate + seed** — through the tunnel: `PLIC_DATABASE_URL=<tunnel url> uv run plic db init`, then `SRC_URL=postgresql://plic:plic@localhost:5433/plic DST_URL=<tunnel url> scripts/seed_open.sh`.
4. **Dokploy** — `project-create name=plataforma-licitante` → `application-create name=web environmentId=<from project>` → `application-saveGithubProvider owner=alexazevedo repository=plataforma-licitante branch=main buildPath=/ githubId=PSIlIbDgqneh8skKGdnix watchPaths=["web/**"]` → `application-saveBuildType buildType=dockerfile dockerfile=web/Dockerfile dockerContextPath=web` → `application-saveEnvironment env="PLIC_DATABASE_URL=<url>\nPORT=3000"` → `domain-create host=plataforma-licitante.site.plugu.solutions port=3000 https=true certificateType=letsencrypt domainType=application applicationId=<id>` → `application-deploy`.
5. **Webhook secret** — `refreshToken` from `application-one`; `gh secret set DOKPLOY_DEPLOY_WEBHOOK --repo alexazevedo/plataforma-licitante --body "https://dokploy.site.plugu.solutions/api/deploy/<refreshToken>"`.

## Checks (run in order — cheapest first)
1. `dig +short plataforma-licitante.site.plugu.solutions | grep -q .`
2. `curl -sf --retry 3 --retry-delay 5 https://plataforma-licitante.site.plugu.solutions/licitacoes | grep -q "page-wide"`
3. Push an empty commit to `main` (`git commit --allow-empty -m "ci: trigger deploy"` + push) → `gh run watch` exits 0 and Dokploy `application-one` shows a new deployment.

## Done when
- Site serves open licitações over HTTPS; a push to `main` produces a green Actions run and a new Dokploy deployment.

## Not included
- No CLI container, no schedule (ticket 22), no auth, no monitoring.
