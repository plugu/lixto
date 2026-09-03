"""`lixto email` — trigger the web app's outbox worker and daily digest.

The outbox/render/SMTP logic is a single implementation in the web app
(tickets 108/110/111/113); this CLI is a thin HTTP trigger so operators and
Dokploy schedules keep one CLI surface.
"""

from __future__ import annotations

import httpx
import typer

from lixto.internal_api import InternalApi, InternalApiError
from lixto.settings import get_internal_token, get_web_internal_url

name = "email"
app = typer.Typer(help="Email commands")

_LIMIT_OPTION = typer.Option(20, "--limit", help="Max messages to send in this pass.")
_COMPANY_ID_OPTION = typer.Option(
    None,
    "--company-id",
    help="Only enqueue the digest for this company (default: every company with an admin).",
)


@app.command("worker")
def worker_cmd(limit: int = _LIMIT_OPTION) -> None:
    """Drain up to `--limit` due messages from the outbox
    (`POST /api/internal/email/send` on the web app).
    """
    try:
        with InternalApi(get_web_internal_url(), get_internal_token()) as client:
            result = client.email_send(limit=limit)
    except (InternalApiError, httpx.HTTPError, RuntimeError) as exc:
        typer.echo(f"error: {exc}", err=True)
        raise typer.Exit(code=1) from None

    typer.echo(f"claimed: {result.get('claimed')}")
    typer.echo(f"sent: {result.get('sent')}")
    typer.echo(f"failed: {result.get('failed')}")
    typer.echo(f"suppressed: {result.get('suppressed')}")


@app.command("digest")
def digest_cmd(company_id: int = _COMPANY_ID_OPTION) -> None:
    """Enqueue today's daily digest, one message per company admin
    (`POST /api/internal/email/digest` on the web app).
    """
    try:
        with InternalApi(get_web_internal_url(), get_internal_token()) as client:
            result = client.email_digest(company_id=company_id)
    except (InternalApiError, httpx.HTTPError, RuntimeError) as exc:
        typer.echo(f"error: {exc}", err=True)
        raise typer.Exit(code=1) from None

    typer.echo(f"companies: {result.get('companies')}")
    typer.echo(f"enqueued: {result.get('enqueued')}")
    typer.echo(f"skipped: {result.get('skipped')}")
