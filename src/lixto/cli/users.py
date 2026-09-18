"""`lixto users` — grant/revoke superadmin flag and list superadmins."""

from __future__ import annotations

import typer

from lixto import db

name = "users"
app = typer.Typer(help="User management commands")


@app.command("grant-superadmin")
def grant_superadmin(email: str) -> None:
    """Grant superadmin access to a user by email."""
    # Normalize email: lowercase and strip whitespace
    email = email.strip().lower()

    conn = db.get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE users SET is_superadmin = true, updated_at = now() WHERE email = %s RETURNING id, name",
                (email,),
            )
            row = cur.fetchone()
        conn.commit()
    finally:
        conn.close()

    if row is None:
        typer.echo(f"error: no user with email {email}", err=True)
        raise typer.Exit(code=1)

    _name = row[1]
    typer.echo(f"granted: {_name} {email}")


@app.command("revoke-superadmin")
def revoke_superadmin(email: str) -> None:
    """Revoke superadmin access from a user by email."""
    # Normalize email: lowercase and strip whitespace
    email = email.strip().lower()

    conn = db.get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE users SET is_superadmin = false, updated_at = now() WHERE email = %s RETURNING id, name",
                (email,),
            )
            row = cur.fetchone()
        conn.commit()
    finally:
        conn.close()

    if row is None:
        typer.echo(f"error: no user with email {email}", err=True)
        raise typer.Exit(code=1)

    _name = row[1]
    typer.echo(f"revoked: {_name} {email}")


@app.command("list-superadmins")
def list_superadmins() -> None:
    """List all superadmins with their company information."""
    conn = db.get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT u.email, u.name, c.legal_name FROM users u JOIN companies c ON c.id = u.company_id WHERE u.is_superadmin ORDER BY u.email"
            )
            rows = cur.fetchall()
    finally:
        conn.close()

    if not rows:
        typer.echo("none")
    else:
        for row in rows:
            email, name, legal_name = row
            typer.echo(f"{email}  {name}  {legal_name}")
