"""`plic` CLI entrypoint (typer)."""

import typer

from plic import db

app = typer.Typer(help="plic — PNCP ingestion agent")
db_app = typer.Typer(help="Database commands")
app.add_typer(db_app, name="db")


@db_app.command("init")
def db_init() -> None:
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


if __name__ == "__main__":
    app()
