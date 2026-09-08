"""`lixto analyze` — the deep, cited tender analysis pass.

Replaces `lixto enrich run` (cycle 18): one doc-tier LLM call per open
procurement over the page-tagged text of all its PDFs writes both the
enrichment facets and the dossier. `lixto enrich embed` still backfills
vectors.
"""

from __future__ import annotations

import typer

from lixto import db, runs
from lixto.analyze.jobs import drain_jobs as run_jobs
from lixto.analyze.worker import analyze as run_analyze

name = "analyze"
app = typer.Typer(help="Tender analysis commands")

_LIMIT_OPTION = typer.Option(None, "--limit", help="Max procurements to process.")
_DAYS_OPTION = typer.Option(
    None,
    "--days",
    help="Only procurements published in the last N days.",
)
_RETRY_ERRORS_OPTION = typer.Option(
    False,
    "--retry-errors",
    help="Also reprocess procurements whose last analysis failed.",
)
_JOBS_LIMIT_OPTION = typer.Option(None, "--limit", help="Max queued jobs to process.")


@app.command("run")
def run_cmd(
    limit: int = _LIMIT_OPTION,
    days: int = _DAYS_OPTION,
    retry_errors: bool = _RETRY_ERRORS_OPTION,
) -> None:
    """Produce the canonical dossier (one per open procurement): enrichment
    facets plus cited facts, dates, requirements, penalties, risks and gaps,
    from the text of every active document. Resumable: procurements that
    already have an analysis are skipped; use --retry-errors to reprocess the
    failed ones.
    """
    conn = db.get_connection()
    try:
        with runs.run(conn, "analyze") as counters:
            result = run_analyze(
                conn,
                limit=limit,
                days=days,
                retry_errors=retry_errors,
                counters=counters,
            )
    finally:
        conn.close()

    typer.echo(f"analyzed: {result['processed']} (done {result['done']}, error {result['error']})")
    typer.echo(
        f"usage: {result.get('llm_calls', 0)} calls, "
        f"{result.get('llm_prompt_tokens', 0)} prompt + "
        f"{result.get('llm_completion_tokens', 0)} completion tokens, "
        f"est US$ {result.get('est_usd', 0.0):.4f}"
    )
    if result.get("cap_reached"):
        typer.echo(f"daily cap reached (cap {result.get('cap')})")
    if result["error"] > 0 and result["done"] == 0:
        typer.echo(
            "no procurement analyzed successfully — check the LLM provider key/URL",
            err=True,
        )
        raise typer.Exit(code=1)


@app.command("jobs")
def jobs_cmd(limit: int = _JOBS_LIMIT_OPTION) -> None:
    """Drain the on-demand `analysis_jobs` queue ("Analisar com IA"): each
    queued job runs `analyze_one` for its procurement, fence and daily cap
    bypassed, and ends `done` or `error`. Exits 0 even when every job in
    this run failed — a bad edital must not fail the Dokploy schedule.
    """
    conn = db.get_connection()
    try:
        with runs.run(conn, "analyze_jobs") as counters:
            result = run_jobs(conn, limit=limit, counters=counters)
    finally:
        conn.close()

    typer.echo(
        f"jobs: {result['processed']} processed (done {result['done']}, error {result['error']})"
    )
    typer.echo(
        f"usage: {result.get('llm_calls', 0)} calls, "
        f"{result.get('llm_prompt_tokens', 0)} prompt + "
        f"{result.get('llm_completion_tokens', 0)} completion tokens, "
        f"est US$ {result.get('est_usd', 0.0):.4f}"
    )
    if result["done"] == 0 and result["error"] > 0:
        typer.echo(f"{result['error']} job(s) failed", err=True)
