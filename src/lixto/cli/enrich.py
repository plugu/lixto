"""`lixto enrich` — embedding backfill (analysed and raw ingested tenders).

The enrichment pass itself moved to `lixto analyze run` in cycle 25 (one
doc-tier call writes the facets *and* the cited dossier); this group keeps
only the vector backfill, which is independent of how the facets were
produced.
"""

from __future__ import annotations

import typer

from lixto import db, runs
from lixto.enrich.embed import embed_ingested, embed_pending

name = "enrich"
app = typer.Typer(help="Enrichment commands")

_LIMIT_OPTION = typer.Option(
    None, "--limit", help="Max procurements to process per pass (analysed, then ingested)."
)


@app.command("embed")
def embed_cmd(limit: int = _LIMIT_OPTION) -> None:
    """Build pgvector vectors in two passes. First, analysed procurements
    whose enrichment is done but has no `procurement_embeddings` row (their
    inline embed call failed). Then, open or upcoming ingested procurements
    with no analysis, embedded from their raw PNCP text so semantic search
    and matching see them too. Resumable and idempotent: with nothing pending
    it is a no-op.
    """
    conn = db.get_connection()
    try:
        with runs.run(conn, "embed") as counters:
            analysed = embed_pending(conn, limit=limit, counters=counters)
            ingested = embed_ingested(conn, limit=limit, counters=counters)
    finally:
        conn.close()

    typer.echo(
        f"embeddings (analysed): {analysed['processed']} processed "
        f"({analysed['embedded']} ok, {analysed['error']} error)"
    )
    typer.echo(
        f"embeddings (ingested): {ingested['ingested_processed']} processed "
        f"({ingested['ingested_embedded']} ok, {ingested['ingested_error']} error)"
    )
    errors = analysed["error"] + ingested["ingested_error"]
    embedded = analysed["embedded"] + ingested["ingested_embedded"]
    if errors > 0 and embedded == 0:
        typer.echo("no embedding produced — check the LLM provider key/URL", err=True)
        raise typer.Exit(code=1)
