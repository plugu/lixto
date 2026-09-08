"""`lixto radar` — trigger the web app's Radar batch detection endpoint.

Detection/scoring is a single implementation in the web app (tickets
124/126); this CLI is a thin HTTP trigger so operators and Dokploy schedules
keep one CLI surface, same shape as `lixto match run`.
"""

from __future__ import annotations

import httpx
import typer

from lixto.internal_api import InternalApi, InternalApiError
from lixto.settings import get_internal_token, get_web_internal_url

name = "radar"
app = typer.Typer(help="Radar commands")

_COMPANY_ID_OPTION = typer.Option(
    None,
    "--company-id",
    help="Only compute company matches for this company (default: every company with a profile).",
)


@app.command("run")
def run_cmd(company_id: int = _COMPANY_ID_OPTION) -> None:
    """Detect future opportunities from the PCA horizon, expire stale ones and
    score them against company profiles (`POST /api/internal/radar/run` on
    the web app).
    """
    try:
        with InternalApi(get_web_internal_url(), get_internal_token()) as client:
            result = client.radar_run(company_id=company_id)
    except (InternalApiError, httpx.HTTPError, RuntimeError) as exc:
        typer.echo(f"error: {exc}", err=True)
        raise typer.Exit(code=1) from None

    typer.echo(f"runId: {result.get('runId')}")
    typer.echo(f"companies: {result.get('companies')}")
    typer.echo(f"opportunities: {result.get('opportunities')}")
    typer.echo(f"matched: {result.get('matched')}")
