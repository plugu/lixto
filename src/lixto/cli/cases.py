"""`lixto cases run` — trigger the web app's case agent endpoint.

The case pipeline (GO recommendation → case → habilitação verdict) is a
single implementation in the web app (ticket 168); this CLI is a thin HTTP
trigger so operators and Dokploy schedules keep one CLI surface.
"""

from __future__ import annotations

import httpx
import typer

from lixto.internal_api import InternalApi, InternalApiError
from lixto.settings import get_internal_token, get_web_internal_url

name = "cases"
app = typer.Typer(help="Case agent commands")

_COMPANY_ID_OPTION = typer.Option(
    None,
    "--company-id",
    help="Only run the case agent for this company (default: every company).",
)


@app.command("run")
def run_cmd(company_id: int = _COMPANY_ID_OPTION) -> None:
    """Turn every GO recommendation into a case and compute its habilitação
    verdict from the dossier plus the company's uploaded documents
    (`POST /api/internal/cases/run` on the web app). No LLM calls.
    """
    try:
        with InternalApi(get_web_internal_url(), get_internal_token()) as client:
            result = client.cases_run(company_id=company_id)
    except (InternalApiError, httpx.HTTPError, RuntimeError) as exc:
        typer.echo(f"error: {exc}", err=True)
        raise typer.Exit(code=1) from None

    typer.echo(f"runId: {result.get('runId')}")
    typer.echo(f"created: {result.get('created')}")
    typer.echo(f"ready: {result.get('ready')}")
    typer.echo(f"waiting: {result.get('waiting')}")
    typer.echo(f"emailed: {result.get('emailed')}")
    typer.echo(f"resultsRequested: {result.get('resultsRequested')}")
    typer.echo(f"resolved: {result.get('resolved')}")
    typer.echo(f"failed: {result.get('failed')}")
