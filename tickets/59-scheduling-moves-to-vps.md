---
id: 59
status: done
model: opus
depends_on: [58]
max_attempts: 3
files:
  - src/plic/schedule.py
  - src/plic/cli.py
  - tests/test_schedule.py
  - README.md
---
## Goal
Remove the macOS launchd scheduler entirely. Scheduling for this project lives on the VPS (Dokploy schedules on the `cli` app), never on a developer machine.

## Context

Correction after the cycle-13 gate. The user's constraint: *nothing related to this project should run on their machine; any cron runs on the VPS to update production.*

What was found on 2026-08-25: `com.plic.sync` was loaded in launchd on the dev machine and actively running `plic sync incremental` against PNCP since 07:00. Uninstalled (`plic schedule uninstall`), plist deleted, process killed.

Ticket 58 made this worse by chaining `plic sync resultados` into the launchd plist — the wrong host entirely. `Dockerfile.cli` already states the intended design: it ends in `sleep infinity` specifically so Dokploy schedules can `exec` into the container.

Production already runs Dokploy schedules on the `cli` app (project `plataforma-licitante`, application `1GYp7T_4WU3zT0dcs01mz`):
- `sync-incremental` — `0 6,13,20 * * *` America/Sao_Paulo, `plic sync incremental --max-detalhes 2000`, enabled.
- `db-init` — cron `0 0 31 2 *` (a date that never occurs = manual-only), disabled.
- `cnae-classify-30d` — same manual-only trick, disabled.
- `sync-resultados` — `0 3 * * *`, `plic sync resultados --limit 2000`, added as part of this correction.

### Changes

- **Delete** `src/plic/schedule.py` and `tests/test_schedule.py`.
- `src/plic/cli.py`: remove the two `from plic.schedule import ...` lines, the `schedule_app` Typer sub-app and its `add_typer`, and both `schedule_install_cmd` / `schedule_uninstall_cmd`. Leave every other command untouched — the incidental words "schedule"/"scheduler" in `--max-detalhes` help text and in `sync_incremental_cmd`'s docstring are about the remote scheduler and stay.
- `README.md`: delete the "Install the Scheduler" quick-start step (renumbering the steps that follow), the "Scheduler (macOS only)" CLI section, the launchd troubleshooting section, and the `launchd (macOS)` bullet under Architecture. Replace the log section's `~/Library/Logs/plic-sync.log` with the Dokploy schedule logs. Add a "Scheduling (production)" section documenting the table of Dokploy schedules above, stating plainly that the CLI ships no scheduler of its own and that schedules are configured in Dokploy on the `cli` app.

Keep `plic sync resultados` documentation as ticket 58 wrote it, minus the sentence claiming the launchd scheduler chains it after each incremental sync — that is now a `0 3 * * *` Dokploy schedule.

## Checks (run in order — cheapest first)
1. `uv run ruff check`
2. `uv run pytest`
3. `uv run plic --help` — exits 0 and lists no `schedule` command.
4. `grep -rn "launchd\|launchctl\|plic-sync.log" README.md src/ tests/` — returns nothing.

## Done when
- `plic schedule` no longer exists as a command.
- No file in the repo tells anyone to install a cron on their own machine.
- README documents the Dokploy schedules as the only scheduling mechanism.

## Not included
- Deploying, or running `db-init` in production — migration 009 reaches prod through the normal deploy flow.
- Touching `src/plic/sync_resultados.py`, the web app, or any other ticket's work.
- Stopping the local dev Postgres container: it is a development database, not a scheduled job.
