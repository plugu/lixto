"""`lixto comprasnet` — operator-driven Compras.gov.br scraping (needs a human
to solve the hCaptcha; never scheduled). See `lixto.scrape.comprasnet`.
"""

from __future__ import annotations

from pathlib import Path

import typer

from lixto.scrape.comprasnet import (
    DEFAULT_ENGINE,
    ENGINES,
    ComprasnetScrapeError,
    parse_compra_id,
    scrape,
)

name = "comprasnet"
app = typer.Typer(help="Compras.gov.br browser scraper (bids, proposals, chat)")

_OUT_OPTION = typer.Option(
    None, "--out", help="Output dir (default: ./scrape-out/comprasnet/<compra_id>)."
)
_TIMEOUT_OPTION = typer.Option(600.0, "--timeout", help="Seconds to wait for the captcha.")
_PROFILE_OPTION = typer.Option(
    None, "--profile", help="Persistent Chromium profile dir (keeps hCaptcha trust cookies)."
)
_PASSIVE_OPTION = typer.Option(
    False, "--passive", help="Do not reuse the token; only record what the page itself loads."
)
_ENGINE_OPTION = typer.Option(
    DEFAULT_ENGINE, "--engine", help=f"Browser engine: {', '.join(ENGINES)}."
)


@app.command("scrape")
def scrape_cmd(
    compra: str = typer.Argument(..., help="17-digit compra id or acompanhamento URL."),
    out: Path | None = _OUT_OPTION,
    timeout: float = _TIMEOUT_OPTION,
    profile: Path | None = _PROFILE_OPTION,
    passive: bool = _PASSIVE_OPTION,
    engine: str = _ENGINE_OPTION,
) -> None:
    """Open the public page in Chromium, wait for you to solve the captcha,
    then save bids/proposals/chat JSON under the output dir.
    """
    try:
        compra_id = parse_compra_id(compra)
        out_dir = out or Path("scrape-out") / "comprasnet" / compra_id
        result = scrape(
            compra_id,
            out_dir,
            timeout_s=timeout,
            profile_dir=profile,
            passive_only=passive,
            engine=engine,
        )
    except ComprasnetScrapeError as exc:
        typer.echo(f"error: {exc}", err=True)
        raise typer.Exit(code=1) from None

    typer.echo(
        f"engine: {result.engine}  mode: {result.mode}  token_reusable: {result.token_reusable}"
    )
    typer.echo(f"items: {len(result.item_numbers)}  files: {len(result.files)}")
    for err in result.errors:
        typer.echo(f"warn: {err}", err=True)
    typer.echo(f"out: {result.out_dir / 'summary.json'}")
    if result.mode == "timeout":
        raise typer.Exit(code=2)
