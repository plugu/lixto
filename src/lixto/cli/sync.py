"""`lixto sync` — PNCP sync commands (auto-mounted, see `lixto/cli/__init__`)."""

from __future__ import annotations

from datetime import date

import typer

from lixto import db
from lixto.runs import run
from lixto.sync.details import sync_details
from lixto.sync.incremental import DEFAULT_MAX_DETAILS
from lixto.sync.incremental import sync_incremental as run_sync_incremental

name = "sync"
app = typer.Typer(help="Sync commands", rich_markup_mode=None)

_SINCE_OPTION = typer.Option(
    None,
    "--since",
    help="YYYY-MM-DD override for modalities with no watermark yet "
    "(default: bootstrap from the newest source_global_updated_at in the DB).",
)
_MAX_DETAILS_OPTION = typer.Option(
    DEFAULT_MAX_DETAILS,
    "--max-details",
    help="Max procurements to fetch items/documents for in this run "
    "(0 = unlimited). Bounds the drain so the watermark phase always runs.",
)
_LIMIT_OPTION = typer.Option(
    None,
    "--limit",
    help="Max procurements to process; default no limit.",
)


@app.command("incremental")
def incremental_cmd(
    since: str = _SINCE_OPTION,
    max_details: int = _MAX_DETAILS_OPTION,
) -> None:
    """Pull everything changed since each modality's watermark
    (`/contratacoes/atualizacao`), then fetch items/documents.

    Exits non-zero if any modality failed after retries, so the scheduler
    surfaces it — the other modalities still run to completion first.
    """
    conn = db.get_connection()
    try:
        result = run_sync_incremental(
            conn,
            since=date.fromisoformat(since) if since else None,
            max_details=None if max_details == 0 else max_details,
        )
    finally:
        conn.close()

    typer.echo(
        f"modalities: {result['modalities_advanced']}/{result['modalities_total']} advanced, "
        f"{len(result['modalities_failed'])} failed; "
        f"rows seen: {result['rows_seen']}; "
        f"details: {result['details_processed']} processed"
    )
    if result["modalities_failed"]:
        typer.echo(
            f"modalities failed after retries: {result['modalities_failed']}",
            err=True,
        )
        raise typer.Exit(1)


@app.command("details")
def details_cmd(limit: int = _LIMIT_OPTION) -> None:
    """Fetch items + document metadata for procurements missing them."""
    conn = db.get_connection()
    try:
        with run(conn, "sync.details") as counters:
            processed = sync_details(conn, limit=limit, counters=counters)
    finally:
        conn.close()

    typer.echo(f"processed {processed} procurement(s)")
