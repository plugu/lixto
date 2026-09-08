"""`lixto plans` — annual procurement plan (PCA) sync commands."""

from __future__ import annotations

import os
from datetime import date

import typer

from lixto import db, runs
from lixto.enrich.plan_embed import DEFAULT_HORIZON_DAYS, embed_pending
from lixto.sync.plans import sync_plans

name = "plans"
app = typer.Typer(help="Annual procurement plan (PCA) commands")

_SINCE_OPTION = typer.Option(
    None,
    "--since",
    help="Window start, YYYY-MM-DD (default: last watermark, else today — nothing "
    "backfills without one).",
)
_UNTIL_OPTION = typer.Option(None, "--until", help="Window end, YYYY-MM-DD (default: today).")
_EMBED_LIMIT_OPTION = typer.Option(
    None,
    "--limit",
    help="Max plan items to embed this run (default: LIXTO_RADAR_EMBED_LIMIT, "
    "0/unset = unlimited).",
)


def _parse_date(value: str | None) -> date | None:
    return date.fromisoformat(value) if value else None


def _resolve_embed_limit(limit: int | None) -> int | None:
    """Plain per-run cap (not the daily-cap machinery of `enrich run`):
    explicit `--limit` wins; otherwise `LIXTO_RADAR_EMBED_LIMIT`; 0/unset on
    either means unlimited."""
    if limit is not None:
        return limit if limit > 0 else None
    raw = os.environ.get("LIXTO_RADAR_EMBED_LIMIT")
    if not raw:
        return None
    try:
        value = int(raw)
    except ValueError:
        return None
    return value if value > 0 else None


def _horizon_days() -> int:
    raw = os.environ.get("LIXTO_RADAR_HORIZON_DAYS")
    if not raw:
        return DEFAULT_HORIZON_DAYS
    try:
        value = int(raw)
    except ValueError:
        return DEFAULT_HORIZON_DAYS
    return value if value > 0 else DEFAULT_HORIZON_DAYS


@app.command("sync")
def sync_cmd(
    since: str | None = _SINCE_OPTION,
    until: str | None = _UNTIL_OPTION,
) -> None:
    """Sync PCA plans (+ items) updated in the window from PNCP's
    `/v1/pca/atualizacao`, walked in <=7-day chunks, watermark-guarded so
    reruns are idempotent and incremental.
    """
    conn = db.get_connection()
    try:
        with runs.run(conn, "sync.plans") as counters:
            result = sync_plans(
                conn,
                since=_parse_date(since),
                until=_parse_date(until),
                counters=counters,
            )
    finally:
        conn.close()

    typer.echo(
        f"plans: {result['plans_seen']} seen, {result['plans_upserted']} upserted, "
        f"{result['items_seen']} items, {result['chunks']} chunk(s)"
    )


@app.command("embed")
def embed_cmd(limit: int = _EMBED_LIMIT_OPTION) -> None:
    """Backfill embeddings: build the pgvector vector for in-horizon PCA
    items (`p.year >= this year`, `desired_date` not past and within
    `LIXTO_RADAR_HORIZON_DAYS`) that have no `plan_item_embeddings` row yet.
    Resumable and idempotent — with nothing pending it is a no-op.
    """
    conn = db.get_connection()
    try:
        with runs.run(conn, "plans.embed") as counters:
            result = embed_pending(
                conn,
                horizon_days=_horizon_days(),
                limit=_resolve_embed_limit(limit),
                counters=counters,
            )
    finally:
        conn.close()

    typer.echo(
        f"embeddings: {result['processed']} processed "
        f"({result['embedded']} ok, {result['error']} error)"
    )
    if result["error"] > 0 and result["embedded"] == 0:
        typer.echo("no embedding produced — check the LLM provider key/URL", err=True)
        raise typer.Exit(code=1)
