"""`lixto cache` — trigger the web app's internal cache revalidation.

The web app memoises global aggregates (dashboard KPIs, `/procurements`
facets, modality options) in an in-process cache keyed by tag (ticket 175).
`lixto sync incremental` already calls this after every run; this command is
the manual trigger for operators who need to drop a tag without a full sync.
"""

from __future__ import annotations

import httpx
import typer

from lixto.internal_api import InternalApi, InternalApiError
from lixto.settings import get_internal_token, get_web_internal_url

name = "cache"
app = typer.Typer(help="Web cache commands")

_TAG_OPTION = typer.Option(
    None,
    "--tag",
    help="Cache tag to drop (repeatable); default: server default (sync).",
)


@app.command("revalidate")
def revalidate_cmd(tag: list[str] = _TAG_OPTION) -> None:
    """Drop one or more cache tags on the web app
    (`POST /api/internal/cache/revalidate`).
    """
    try:
        with InternalApi(get_web_internal_url(), get_internal_token()) as client:
            result = client.cache_revalidate(tags=tag or None)
    except (InternalApiError, httpx.HTTPError, RuntimeError) as exc:
        typer.echo(f"error: {exc}", err=True)
        raise typer.Exit(code=1) from None

    typer.echo(f"revalidated: {result.get('revalidated')}")
    typer.echo(f"dropped: {result.get('dropped')}")
