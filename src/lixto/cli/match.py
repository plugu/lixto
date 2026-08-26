"""`lixto match` — trigger the web app's batch matching endpoint.

Scoring is a single implementation in the web app (ticket 90); this CLI is a
thin HTTP trigger so operators and Dokploy schedules keep one CLI surface.
"""

from __future__ import annotations

import httpx
import typer

from lixto.internal_api import InternalApi, InternalApiError
from lixto.settings import get_internal_token, get_web_internal_url

name = "match"
app = typer.Typer(help="Match commands")

_COMPANY_ID_OPTION = typer.Option(
    None, "--company-id", help="Only match this company (default: every company with a profile)."
)
_SINCE_OPTION = typer.Option(
    None,
    "--since",
    help="YYYY-MM-DD; only score procurements enriched since then "
    "(default: since the last successful match run).",
)


@app.command("run")
def run_cmd(
    company_id: int = _COMPANY_ID_OPTION,
    since: str = _SINCE_OPTION,
) -> None:
    """Score procurements enriched since the last run against every company
    profile/CNAEs, persist `matches` and upsert `opportunities`
    (`POST /api/internal/match/run` on the web app).
    """
    try:
        with InternalApi(get_web_internal_url(), get_internal_token()) as client:
            result = client.match_run(company_id=company_id, since=since)
    except (InternalApiError, httpx.HTTPError, RuntimeError) as exc:
        typer.echo(f"error: {exc}", err=True)
        raise typer.Exit(code=1) from None

    typer.echo(f"runId: {result.get('runId')}")
    typer.echo(f"companies: {result.get('companies')}")
    typer.echo(f"scored: {result.get('scored')}")
    typer.echo(f"matched: {result.get('matched')}")
    typer.echo(f"attention: {result.get('attention')}")
