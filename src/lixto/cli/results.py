"""`lixto results` — homologated-result commands (auto-mounted, see
`lixto/cli/__init__`).

Named `results`, not folded into `cli/sync.py`'s `sync` group, because that
module already owns the top-level `sync` name (ticket 75) — the command
below lands at `lixto results sync`, not `lixto sync results`.
"""

from __future__ import annotations

import typer

from lixto import db
from lixto.runs import run
from lixto.sync.results import sync_results

name = "results"
app = typer.Typer(help="Homologated-result commands", rich_markup_mode=None)

_LIMIT_OPTION = typer.Option(
    None,
    "--limit",
    help="Max queued items (results_requested_at IS NOT NULL AND "
    "results_synced_at IS NULL) to process; default no limit.",
)


@app.command("sync")
def sync_cmd(limit: int = _LIMIT_OPTION) -> None:
    """Drain the demand queue of items and store homologated results
    (winner, unit price) in `procurement_results`."""
    conn = db.get_connection()
    try:
        with run(conn, "sync.results") as counters:
            processed = sync_results(conn, limit=limit, counters=counters)
    finally:
        conn.close()

    typer.echo(f"processed {processed} item(s)")
