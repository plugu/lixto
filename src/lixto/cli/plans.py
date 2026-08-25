"""`lixto plans` — annual procurement plan (PCA) sync commands."""

from __future__ import annotations

from datetime import date

import typer

from lixto import db, runs
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


def _parse_date(value: str | None) -> date | None:
    return date.fromisoformat(value) if value else None


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
