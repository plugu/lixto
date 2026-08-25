"""`lixto backfill` — top-level command (registered via `register(root)`)."""

from __future__ import annotations

from datetime import date

import typer

from lixto import db
from lixto.sync.backfill import DEFAULT_MAX_DETAILS, DEFAULT_SINCE
from lixto.sync.backfill import backfill as run_backfill
from lixto.sync.procurements import ALL_MODALITIES

_SINCE_OPTION = typer.Option(
    DEFAULT_SINCE.isoformat(),
    "--since",
    help="YYYY-MM-DD, backfill start date. Default 2026-01-01.",
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
    until: str = _UNTIL_OPTION,
    modality: list[int] = _MODALITY_OPTION,
    max_details: int = _MAX_DETAILS_OPTION,
) -> None:
    """Resumable backfill: every modality x 7-day date chunk from `--since`
    (default 2026-01-01) to `--until` (default today), then a bounded drain of
    items/documents. `--until`/`--modality` exist to bound test/probe runs; a
    real full backfill is `lixto backfill` bare.
    """
    conn = db.get_connection()
    try:
        result = run_backfill(
            conn,
            since=date.fromisoformat(since),
            until=date.fromisoformat(until) if until else None,
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
