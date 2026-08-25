"""`lixto cnae` — CNAE reference data commands."""

from __future__ import annotations

import typer

from lixto import db, runs
from lixto.cnae_seed import seed as run_seed

name = "cnae"
app = typer.Typer(help="CNAE reference commands")


@app.command("seed")
def seed_cmd() -> None:
    """Fetch the IBGE CNAE subclasses list and upsert it into `cnae_codes`
    (idempotent — safe to rerun to refresh descriptions)."""
    conn = db.get_connection()
    try:
        with runs.run(conn, "cnae.seed") as counters:
            result = run_seed(conn)
            counters.inc("seeded", result["seeded"])
    finally:
        conn.close()

    typer.echo(f"cnae_codes: {result['seeded']} row(s) seeded")
