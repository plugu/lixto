"""`lixto enrich` — embedding backfill for the global enrichment.

The enrichment pass itself moved to `lixto analyze run` in cycle 25 (one
doc-tier call writes the facets *and* the cited dossier); this group keeps
only the vector backfill, which is independent of how the facets were
produced.
"""

from __future__ import annotations

import typer

from lixto import db, runs
from lixto.enrich.embed import embed_pending

name = "enrich"
app = typer.Typer(help="Enrichment commands")

_LIMIT_OPTION = typer.Option(None, "--limit", help="Max procurements to process.")


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
