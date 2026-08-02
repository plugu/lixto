---
id: 06
status: todo
model: haiku
depends_on: [05]
max_attempts: 3
files:
  - src/plic/schedule.py
  - src/plic/cli.py
  - README.md
  - tests/test_schedule.py
---
## Goal
`plic schedule install` sets up the twice-daily macOS launchd job; README documents setup and example queries.

## Context
macOS (darwin). Generate `~/Library/LaunchAgents/com.plic.sync.plist`: `StartCalendarInterval` at 07:00 and 19:00, runs `uv run --project <abs repo path> plic sync incremental`, logs to `~/Library/Logs/plic-sync.log` (stdout+stderr). Commands: `plic schedule install` (write plist + `launchctl bootstrap gui/$UID` after `bootout` if already loaded), `plic schedule uninstall`, `plic schedule install --dry-run` (print plist, write nothing). Use absolute paths for `uv` (resolve via `shutil.which`) — launchd has no user PATH.

README: prerequisites (docker, uv), quickstart (`docker compose up -d`, `plic db init`, `plic backfill`, `plic schedule install`), CLI command list, and example SQL for the success demo: open/upcoming/closed since 2026-01-01 filtered by modalidade/UF/órgão, items via join, edital URLs (`documento.tipo_documento_id = 2`), FTS on `objeto_compra`.

## Checks (run in order — cheapest first)
1. `uv run ruff check .`
2. `uv run pytest`
3. `uv run plic schedule install --dry-run | plutil -lint - && uv run plic schedule install && launchctl print gui/$UID/com.plic.sync | grep -q com.plic.sync`

## Done when
- launchd job installed and listed; `--dry-run` output is valid plist.
- README lets a fresh reader go from clone to scheduled syncs + run the demo queries.

## Not included
- No cron/systemd variants, no alerting, no log rotation, no changes to sync logic.
