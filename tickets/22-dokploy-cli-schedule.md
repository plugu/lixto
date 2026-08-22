---
id: 22
status: done
model: orchestrator
depends_on: [18, 21]
max_attempts: 3
files: []
---
## Goal
`plic sync incremental` runs on the VPS three times a day against the shared DB via a Dokploy schedule, with exit code and logs visible in Dokploy.

## Context
**Executed by the orchestrator in-session via the `dokploy` MCP — not a subagent.** Live steps confirmed with the user first.

Dokploy schedules (`schedule-create`, `scheduleType: "application"`) exec `command` inside the application's running container — so the CLI needs a long-lived container. `Dockerfile.cli` (ticket 18) defaults to `sleep infinity` for exactly this.

Steps (same Dokploy project/environment as ticket 21):
1. `application-create name=cli environmentId=<same>` → `application-saveGithubProvider` (same repo/branch/githubId, `buildPath=/`, `watchPaths=["src/**","migrations/**","pyproject.toml","uv.lock","Dockerfile.cli"]`) → `application-saveBuildType buildType=dockerfile dockerfile=Dockerfile.cli dockerContextPath=.` → `application-saveEnvironment env="PLIC_DATABASE_URL=<same url as web>\nPLIC_MIN_REQUEST_INTERVAL=0.25"` → `application-deploy`. No domain.
2. `schedule-create applicationId=<cli app> scheduleType=application name=sync-incremental cronExpression="0 6,13,20 * * *" timezone="America/Sao_Paulo" shellType=sh command="plic sync incremental --max-detalhes 2000" enabled=true`.
3. Trigger once manually (`schedule-runManually`) and read its log.
4. `.github/workflows/deploy.yml` paths filter: Dokploy's own GitHub webhook (from `saveGithubProvider`) handles the cli app on push; the Actions workflow only targets the web app's token. If the GitHub-app webhook is not active on this Dokploy, add the cli app's refreshToken webhook as a second step in the workflow (micro-ticket).

## Checks (run in order — cheapest first)
1. `application-one <cli>` → `applicationStatus: done`.
2. Manual schedule run log contains `modalidades:` summary line and no `FAILED modalidades`.
3. Through the tunnel: `psql "$DST_URL" -tc "select max(updated_at) from licitacao"` (or `sync_state` watermark) is within the last hour.

## Done when
- Schedule listed under the cli app with the 3×/day cron; one manual run succeeded and advanced the DB.

## Not included
- No agents run, no OpenAI key, no alerting.
