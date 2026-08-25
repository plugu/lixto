"""`lixto enrich` — global procurement enrichment and embedding backfill."""

from __future__ import annotations

import typer

from lixto import db, runs
from lixto.enrich.embed import embed_pending
from lixto.enrich.worker import enrich as run_enrich

name = "enrich"
app = typer.Typer(help="Enrichment commands")

_LIMIT_OPTION = typer.Option(None, "--limit", help="Max procurements to process.")
_DAYS_OPTION = typer.Option(
    None,
    "--days",
    help="Only procurements published in the last N days.",
)
_RETRY_ERRORS_OPTION = typer.Option(
    False,
    "--retry-errors",
    help="Also reprocess procurements whose last enrichment failed.",
)


@app.command("run")
def run_cmd(
    limit: int = _LIMIT_OPTION,
    days: int = _DAYS_OPTION,
    retry_errors: bool = _RETRY_ERRORS_OPTION,
) -> None:
    """Produce the canonical global enrichment (one per open procurement),
    routing each row to the cheapest model tier that can answer (edital text
    → cheap, scanned PDF → doc tier, no document → structured metadata only).
    Resumable: already enriched procurements are skipped; use --retry-errors
    to reprocess the failed ones.
    """
    conn = db.get_connection()
    try:
        with runs.run(conn, "enrich") as counters:
            result = run_enrich(
                conn,
                limit=limit,
                days=days,
                retry_errors=retry_errors,
                counters=counters,
            )
    finally:
        conn.close()

    typer.echo(f"enriched: {result['processed']} (done {result['done']}, error {result['error']})")
    if result["error"] > 0 and result["done"] == 0:
        typer.echo(
            "no procurement enriched successfully — check the LLM provider key/URL",
            err=True,
        )
        raise typer.Exit(code=1)


@app.command("embed")
def embed_cmd(limit: int = _LIMIT_OPTION) -> None:
    """Backfill embeddings: build the pgvector vector for enrichments that
    are done but have no `procurement_embeddings` row (their inline embed
    call failed). Resumable and idempotent — with nothing pending it is a
    no-op.
    """
    conn = db.get_connection()
    try:
        with runs.run(conn, "embed") as counters:
            result = embed_pending(conn, limit=limit, counters=counters)
    finally:
        conn.close()

    typer.echo(
        f"embeddings: {result['processed']} processed "
        f"({result['embedded']} ok, {result['error']} error)"
    )
    if result["error"] > 0 and result["embedded"] == 0:
        typer.echo("no embedding produced — check the LLM provider key/URL", err=True)
        raise typer.Exit(code=1)
