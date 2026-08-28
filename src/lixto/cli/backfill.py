"""`lixto backfill` — top-level command (registered via `register(root)`)."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

import typer

from lixto import db
from lixto.sync.backfill import DEFAULT_MAX_DETAILS, DEFAULT_SINCE
from lixto.sync.backfill import backfill as run_backfill
from lixto.sync.procurements import ALL_MODALITIES

_SINCE_OPTION = typer.Option(
    DEFAULT_SINCE.isoformat(),
    "--since",
    help="YYYY-MM-DD, backfill start date. Default 2026-01-01. Mutually exclusive with --days.",
)
_DAYS_OPTION = typer.Option(
    None,
    "--days",
    help="Backfill the last N days (since = today - N, or until - N when "
    "--until is set). Mutually exclusive with --since.",
)
_UNTIL_OPTION = typer.Option(
    None,
    "--until",
    help="YYYY-MM-DD, backfill end date (inclusive). Default today. "
    "Mainly for bounding test/probe runs — a real full backfill omits this.",
)
_MODALITY_OPTION = typer.Option(
    [],
    "--modality",
    help="Modality code(s) to sync; repeatable. Default: all 13 modalities.",
)
_MAX_DETAILS_OPTION = typer.Option(
    DEFAULT_MAX_DETAILS,
    "--max-details",
    help="Max procurements to fetch items/documents for at the end of this "
    "run (0 = unlimited). The rest drains via `lixto sync details`.",
)


def backfill_cmd(
    since: str = _SINCE_OPTION,
    days: int = _DAYS_OPTION,
    until: str = _UNTIL_OPTION,
    modality: list[int] = _MODALITY_OPTION,
    max_details: int = _MAX_DETAILS_OPTION,
) -> None:
    """Resumable backfill: every modality x 7-day date chunk from `--since`
    (default 2026-01-01) to `--until` (default today), then a bounded drain of
    items/documents. `--until`/`--modality` exist to bound test/probe runs; a
    real full backfill is `lixto backfill` bare. `--days N` is shorthand for
    `--since` computed as `--until` (or today) minus N days; the two options
    are mutually exclusive.
    """
    if days is not None and since != _SINCE_OPTION.default:
        raise typer.BadParameter("--days and --since are mutually exclusive")

    until_date = date.fromisoformat(until) if until else None
    if days is not None:
        since_date = (until_date or datetime.now(tz=UTC).date()) - timedelta(days=days)
    else:
        since_date = date.fromisoformat(since)

    conn = db.get_connection()
    try:
        result = run_backfill(
            conn,
            since=since_date,
            until=until_date,
            modalities=modality or ALL_MODALITIES,
            max_details=None if max_details == 0 else max_details,
        )
    finally:
        conn.close()

    typer.echo(
        f"units: {result['units_processed']} processed, "
        f"{result['units_skipped']} skipped, "
        f"{len(result['units_failed'])} failed of {result['units_total']} total; "
        f"details: {result['details_processed']} processed"
    )
    if result["units_failed"]:
        typer.echo("some units failed — re-run `lixto backfill` to retry them", err=True)
        raise typer.Exit(1)


def register(root: typer.Typer) -> None:
    root.command("backfill")(backfill_cmd)
