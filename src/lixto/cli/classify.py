"""`lixto classify` — closed-taxonomy classification (cycle 32)."""

from __future__ import annotations

from pathlib import Path

import typer

from lixto import db, runs
from lixto.classify.export import export_sample
from lixto.classify.labels import embed_labels, verify_taxonomy
from lixto.classify.worker import classify as run_classify
from lixto.internal_api import revalidate_web_cache_best_effort

name = "classify"
app = typer.Typer(help="Classification commands")

_FORCE_OPTION = typer.Option(
    False, "--force", help="Re-embed every label, not only those without a vector."
)
_LIMIT_OPTION = typer.Option(None, "--limit", help="Max tenders to classify.")
_RETRY_ERRORS_OPTION = typer.Option(
    False, "--retry-errors", help="Also reclassify tenders whose last classification failed."
)
_EXPORT_LIMIT_OPTION = typer.Option(100, "--limit", help="Rows in the review sample.")
_EXPORT_OUT_OPTION = typer.Option(
    Path("scrape-out/classify-sample.csv"), "--out", help="CSV output path."
)


@app.command("embed-labels")
def embed_labels_cmd(force: bool = _FORCE_OPTION) -> None:
    """Embed CNAE subclasses and taxonomy segments so tenders can be classified
    by cosine distance. Idempotent: only missing vectors are built unless
    --force. Refuses to run when the seeded segments drifted from the code."""
    conn = db.get_connection()
    try:
        drift = verify_taxonomy(conn)
        if drift:
            typer.echo(
                "taxonomy drift between code and classification_segments: " + ", ".join(drift),
                err=True,
            )
            raise typer.Exit(code=1)
        with runs.run(conn, "classify.labels") as counters:
            result = embed_labels(conn, counters=counters, force=force)
    finally:
        conn.close()

    typer.echo(
        f"labels embedded: {result['cnae_embedded']} CNAE subclasses, "
        f"{result['segments_embedded']} segments"
    )


@app.command("run")
def run_cmd(
    limit: int = _LIMIT_OPTION,
    retry_errors: bool = _RETRY_ERRORS_OPTION,
) -> None:
    """Classify pending open tenders: up to 3 CNAEs, a segment, a nature and
    keywords each, from cosine candidates plus one CHEAP LLM choice. Resumable:
    classified tenders are skipped; --retry-errors reprocesses the failed ones.
    Honours LIXTO_CLASSIFY_DAILY_CAP and LIXTO_CLASSIFY_MODALITIES."""
    conn = db.get_connection()
    try:
        with runs.run(conn, "classify") as counters:
            result = run_classify(conn, limit=limit, retry_errors=retry_errors, counters=counters)
    finally:
        conn.close()

    typer.echo(
        f"classified: {result['processed']} processed "
        f"(done {result['classified']}, error {result['error']})"
    )
    typer.echo(
        f"usage: {result.get('llm_calls', 0)} calls, "
        f"{result.get('llm_prompt_tokens', 0)} prompt + "
        f"{result.get('llm_completion_tokens', 0)} completion tokens, "
        f"est US$ {result.get('est_usd', 0.0):.4f}"
    )
    if result.get("cap_reached"):
        typer.echo(f"daily cap reached (cap {result.get('cap')})")
    revalidate_web_cache_best_effort()
    if result["error"] > 0 and result["classified"] == 0:
        typer.echo(
            "no tender classified successfully — check the LLM provider key/URL",
            err=True,
        )
        raise typer.Exit(code=1)


@app.command("export")
def export_cmd(
    limit: int = _EXPORT_LIMIT_OPTION,
    out: Path = _EXPORT_OUT_OPTION,
) -> None:
    """Write a random sample of classified tenders to CSV for manual review."""
    conn = db.get_connection()
    try:
        written = export_sample(conn, limit=limit, out=out)
    finally:
        conn.close()
    typer.echo(f"exported {written} rows to {out}")
