---
id: 154
status: done
model: haiku
depends_on: [153]
max_attempts: 4
files:
  - src/lixto/cli/users.py
  - tests/test_cli_users.py
---
## Goal
`lixto users grant-superadmin <email>`, `lixto users revoke-superadmin <email>` and `lixto users list-superadmins` toggle and show the `users.is_superadmin` flag.

## Context
CLI discovery contract: a module in `src/lixto/cli/` exporting `name = "users"` and `app = typer.Typer(...)` is mounted automatically (read the docstring of `src/lixto/cli/__init__.py`; `src/lixto/cli/status.py` and `src/lixto/cli/email.py` are the shape to copy). DB access: `from lixto import db; conn = db.get_connection()` (psycopg 3), close in `finally`.

Commands:
- `grant-superadmin EMAIL` / `revoke-superadmin EMAIL`: lowercase + strip the email; `UPDATE users SET is_superadmin = %s, updated_at = now() WHERE email = %s RETURNING id, name`; commit; print `granted: <name> <email>` / `revoked: ...`; if no row, print `error: no user with email <email>` to stderr and `raise typer.Exit(code=1)`.
- `list-superadmins`: `SELECT u.email, u.name, c.legal_name FROM users u JOIN companies c ON c.id = u.company_id WHERE u.is_superadmin ORDER BY u.email`; one line per row `email  name  legal_name`; print `none` when empty.

Tests (`tests/test_cli_users.py`, `typer.testing.CliRunner` against `from lixto.cli import app`, same style as `tests/test_cli_email.py`): monkeypatch `lixto.cli.users.db.get_connection` with a stub connection whose cursor records `execute` args and returns a canned row / no row; assert SQL params, exit codes and output for all three commands, plus email normalization (`"  Foo@Bar.com "` → `"foo@bar.com"`).

## Checks (run in order — cheapest first)
1. `uv run ruff check src tests && uv run ruff format --check src tests`
2. `uv run pytest tests/test_cli_users.py tests/test_cli_discovery.py -q`
3. `uv run lixto users --help | grep -q grant-superadmin`

## Done when
- `LIXTO_DATABASE_URL=postgresql://lixto:lixto@localhost:5433/lixto uv run lixto users grant-superadmin <existing dev email>` prints `granted: ...` and `list-superadmins` shows the row; `revoke-superadmin` reverses it.

## Not included
- Creating users; any web code; README (160).
