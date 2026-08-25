"""`lixto db` — database commands (migrations)."""

from __future__ import annotations

import typer

from lixto import db

name = "db"
app = typer.Typer(help="Database commands")


@app.command("init")
def init() -> None:
    """Apply all pending SQL migrations (idempotent)."""
    conn = db.get_connection()
    try:
        applied = db.run_migrations(conn)
    finally:
        conn.close()

    if applied:
        typer.echo(f"Applied {len(applied)} migration(s): {', '.join(applied)}")
    else:
        typer.echo("No pending migrations. Database is up to date.")
