"""`lixto recommend` — trigger the web app's batch GO/NO-GO endpoint.

The Tier-3 recommendation logic is a single implementation in the web app
(ticket 91); this CLI is a thin HTTP trigger so operators and Dokploy
schedules keep one CLI surface.
"""

from __future__ import annotations

import httpx
import typer

from lixto.internal_api import InternalApi, InternalApiError
from lixto.settings import get_internal_token, get_web_internal_url

name = "recommend"
app = typer.Typer(help="Recommendation commands")

_COMPANY_ID_OPTION = typer.Option(
    None,
    "--company-id",
    help="Only recommend for this company (default: every company with a profile).",
)
_LIMIT_OPTION = typer.Option(
    None,
    "--limit",
    help="Max new opportunities per company to recommend today (server-enforced hard cap).",
)


@app.command("run")
def run_cmd(
    company_id: int = _COMPANY_ID_OPTION,
    limit: int = _LIMIT_OPTION,
) -> None:
    """Build a capped go/no_go/borderline recommendation, with Portuguese
    rationale and confidence, for the top new opportunities per company
    (`POST /api/internal/recommend/run` on the web app).
    """
    try:
        with InternalApi(get_web_internal_url(), get_internal_token()) as client:
            result = client.recommend_run(company_id=company_id, limit=limit)
    except (InternalApiError, httpx.HTTPError, RuntimeError) as exc:
        typer.echo(f"error: {exc}", err=True)
        raise typer.Exit(code=1) from None

    typer.echo(f"runId: {result.get('runId')}")
    typer.echo(f"companies: {result.get('companies')}")
    typer.echo(f"recommended: {result.get('recommended')}")
    typer.echo(f"skipped_cap: {result.get('skipped_cap')}")
    typer.echo(f"failed: {result.get('failed')}")
