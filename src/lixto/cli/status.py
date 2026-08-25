"""`lixto status` — top-level command (registered via `register(root)`)."""

from __future__ import annotations

import typer

from lixto import db
from lixto.status import format_status, get_status


def status_cmd() -> None:
    """Print counts/watermarks of the current mirror state."""
    conn = db.get_connection()
    try:
        report = get_status(conn)
    finally:
        conn.close()

    typer.echo(format_status(report))


def register(root: typer.Typer) -> None:
    root.command("status")(status_cmd)
