"""`lixto contracts` — sync contracts and their amendments from PNCP."""

from __future__ import annotations

from datetime import date

import typer

from lixto import db, runs
from lixto.pncp_client import PncpClient
from lixto.sync.contracts import sync_amendments, sync_contracts

name = "contracts"
app = typer.Typer(help="Contract sync commands")

_SINCE_OPTION = typer.Option(
    None,
    "--since",
    help="YYYY-MM-DD. Bootstrap window start when no watermark exists yet "
    "(default: newest source_global_updated_at already synced, or today).",
)
_UNTIL_OPTION = typer.Option(
    None,
    "--until",
    help="YYYY-MM-DD (default: today).",
)
_MAX_AMENDMENTS_OPTION = typer.Option(
    None,
    "--max-amendments",
    help="Max contracts to drain amendments for in this run (default: unlimited).",
)
_LIMIT_OPTION = typer.Option(
    None,
    "--limit",
    help="Max contracts to drain amendments for (default: unlimited).",
)


@app.command("sync")
def sync_cmd(
    since: str = _SINCE_OPTION,
    until: str = _UNTIL_OPTION,
    max_amendments: int = _MAX_AMENDMENTS_OPTION,
) -> None:
    """Sync contracts changed since the watermark (`/v1/contratos/atualizacao`),
    then drain amendments (`/termos`) for up to `--max-amendments` contracts
    that don't have them yet.
    """
    conn = db.get_connection()
    client = PncpClient()
    try:
        with runs.run(conn, "sync.contracts") as counters:
            contracts_result = sync_contracts(
                conn,
                since=date.fromisoformat(since) if since else None,
                until=date.fromisoformat(until) if until else None,
                client=client,
                counters=counters,
            )
        with runs.run(conn, "sync.amendments") as counters:
            amendments_result = sync_amendments(
                conn,
                limit=max_amendments,
                client=client,
                counters=counters,
            )
    finally:
        client.close()
        conn.close()

    typer.echo(
        f"contracts: {contracts_result['rows_seen']} row(s) seen, "
        f"watermark -> {contracts_result['watermark']}"
    )
    typer.echo(
        f"amendments: {amendments_result['processed']} contract(s) drained, "
        f"{amendments_result['amendments']} amendment(s)"
    )


@app.command("amendments")
def amendments_cmd(limit: int = _LIMIT_OPTION) -> None:
    """Drain amendments (`/termos`) for contracts that don't have them yet,
    independent of `sync` (e.g. to catch up on a large backlog)."""
    conn = db.get_connection()
    try:
        with runs.run(conn, "sync.amendments") as counters:
            result = sync_amendments(conn, limit=limit, counters=counters)
    finally:
        conn.close()

    typer.echo(
        f"amendments: {result['processed']} contract(s) drained, "
        f"{result['amendments']} amendment(s)"
    )
