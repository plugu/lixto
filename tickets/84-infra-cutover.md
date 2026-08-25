---
id: 84
status: todo
model: opus
depends_on: [83]
max_attempts: 4
files: []
---
## Goal
Production runs Lixto from the renamed repo and Dokploy apps on the new `lixto` database, with PNCP backfill started.

## Context

**Executed by the orchestrator with the user (Dokploy MCP + gh + ssh), not by an implementer** — every step below that touches shared infra gets explicit approval. Facts: Dokploy project `plataforma-licitante` (`6zlcPIz8zvmdi25gGoqlo`), apps `web` (`k62Z-MLD6O005blue5dnc`) and `cli` (`1GYp7T_4WU3zT0dcs01mz`), shared Postgres `pg-shared-nyfajl` (superuser `shared`; provisioning via vps-infra `provision-db.sh` run inside `docker run --rm --network dokploy-network postgres:18`), GitHub `alexazevedo/plataforma-licitante` (private, SSH remote). Memory notes: `application-deploy` (not redeploy) after pushes; MCP `schedule-runManually` times out at 30 s but the job runs.

### Runbook
1. **Database**: provision database `lixto` + role `lixto` on `pg-shared` (provision script or `CREATE ROLE lixto LOGIN PASSWORD …; CREATE DATABASE lixto OWNER lixto;`). Record the URL.
2. **GitHub**: `gh repo rename lixto` → `alexazevedo/lixto`; update local remote (`git remote set-url origin git@github.com:alexazevedo/lixto.git`); rename the local checkout directory to `~/dev/lixto` (Claude memory dir is keyed by path — note the new path).
3. **Dokploy**: create project `lixto` with apps `lixto-web` (Dockerfile `web/Dockerfile`, build context `web`, domain = current web domain moved over, volume `lixto-uploads` → `/app/uploads`, env `LIXTO_DATABASE_URL`, `LIXTO_LLM_*`, `LIXTO_CHAT_MODEL`, `UPLOADS_DIR`) and `lixto-cli` (`Dockerfile.cli`, env `LIXTO_DATABASE_URL`, `LIXTO_LLM_*`), Git provider pointing at the renamed repo, autoDeploy watch paths as before. New webhooks → GitHub secrets `DOKPLOY_DEPLOY_WEBHOOK_WEB` / `_CLI`. Schedules on `lixto-cli`: `sync-incremental` `0 6,13,20 * * *` → `lixto sync incremental --max-details 2000`; `results-sync` `0 3 * * *` → `lixto results sync --limit 2000`; `plans-sync` `0 4 * * *` → `lixto plans sync`; `contracts-sync` `0 5 * * *` → `lixto contracts sync --max-amendments 500`; `enrich-run` `30 7,14,21 * * *` → `lixto enrich run --days 30 --limit 300`; `enrich-embed` manual (`0 0 31 2 *`) → `lixto enrich embed`; `db-init` manual → `lixto db init`.
4. **Deploy**: push `main`; `application-deploy` both apps; `lixto db init` runs on cli start → verify 35 tables (34 + schema_migrations) in `lixto`.
5. **Populate**: run `lixto cnae seed`, then start `lixto backfill` (schedule run or `docker exec`) — it takes days; then `lixto plans sync --since 2026-01-01`, `lixto contracts sync --since 2026-01-01`. Enrichment schedules pick up as data lands.
6. **Verify**: sign up a company at the new domain, fill `/company/profile`, ask `/lixto` a question once ≥ 1 enriched procurement exists.
7. **Decommission** (only after 6 passes, separate approval): stop/delete Dokploy project `plataforma-licitante`, `DROP DATABASE "plataforma-licitante_db"`, remove old uploads volume.

## Checks (run in order — cheapest first)
1. `gh repo view alexazevedo/lixto --json name -q .name` prints `lixto`
2. Dokploy MCP `application-one` for `lixto-web` and `lixto-cli` report `applicationStatus: done`
3. `curl -s -o /dev/null -w '%{http_code}' https://<web-domain>/login` → `200`
4. Dokploy `postgres-readLogs` / cli app logs show `Applied 1 migration(s): 001_core.sql`
5. `lixto status` via cli container logs shows procurements > 0 after the first backfill chunk

## Done when
- Lixto serves from the renamed infra on the new DB with backfill running; legacy project/DB decommissioned after verification.

## Not included
- Code changes (none); legacy code deletion (85); docs (86).
