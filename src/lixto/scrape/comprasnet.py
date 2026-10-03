"""Compras.gov.br public "acompanhamento" scraper (bid history, proposals, chat).

Why a browser: PNCP publishes only the homologated result per item; the bid
history (lances), the initial/updated proposals and the session chat of a
Compras.gov.br tender live in the "Novo Comprasnet" SPA at
`cnetmobile.estaleiro.serpro.gov.br`. Its public JSON endpoints all require an
hCaptcha token (`?captcha=…`); without one they answer `204` with no body.
The legacy `comprasnet.gov.br/livre/pregao/ata*.asp` pages are open, but only
index pre-Lei 14.133 tenders (verified 2026-10-02: 55 atas on 2023-03-15, zero
for any 2025/2026 date).

What this does, and does not, do:

* Opens a headed browser on the public page and **waits for a human to solve
  the captcha**. It never solves, replays or forges a token. Default engine is
  Camoufox (Playwright Firefox with a consistent, non-automation fingerprint,
  so the session is treated like an ordinary visitor rather than blocked
  outright); `engine="chromium"` uses stock Playwright Chromium.
* Once the SPA makes its first authorised call, reuses *that* token for a
  bounded set of read-only GETs (compra, items, proposals, bids, chat) through
  the same browser context, and saves every JSON body under `out_dir/raw/`.
* If the backend refuses the reused token, falls back to *passive* mode: the
  window stays open, every JSON the SPA itself fetches while the operator
  clicks around is saved, until the operator presses Enter.

Compra id: 17 digits — UASG (6) + modality (2) + number (5) + year (4), e.g.
`98233305900382026` is pregão 90038/2026 of UASG 982333. Modality `05` is the
pregão eletrônico code used by Compras.gov.br for both laws.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import sys
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

log = logging.getLogger(__name__)

BASE_URL = "https://cnetmobile.estaleiro.serpro.gov.br"
PUBLIC_PAGE = f"{BASE_URL}/comprasnet-web/public/compras/acompanhamento-compra"
FASE_EXTERNA = f"{BASE_URL}/comprasnet-fase-externa"
DISPUTA = f"{BASE_URL}/comprasnet-disputa"
MENSAGEM = f"{BASE_URL}/comprasnet-mensagem"
API_SERVICES = ("/comprasnet-fase-externa/", "/comprasnet-disputa/", "/comprasnet-mensagem/")

ENGINES = ("camoufox", "chromium")
DEFAULT_ENGINE = "camoufox"
PREGAO_MODALITY = "05"
PAGE_SIZE = 50
MAX_PAGES = 200  # safety valve; 200 × 50 = 10 000 rows per list


class ComprasnetScrapeError(RuntimeError):
    pass


_COMPRA_RE = re.compile(r"\b(\d{17})\b")


def parse_compra_id(value: str) -> str:
    """Accept a bare 17-digit id or any URL carrying `compra=<id>`."""
    value = value.strip()
    if value.isdigit() and len(value) == 17:
        return value
    if "://" in value:
        qs = parse_qs(urlparse(value).query)
        for candidate in qs.get("compra", []):
            if candidate.isdigit() and len(candidate) == 17:
                return candidate
    match = _COMPRA_RE.search(value)
    if match:
        return match.group(1)
    raise ComprasnetScrapeError(
        f"not a Compras.gov.br compra id (17 digits) or acompanhamento URL: {value!r}"
    )


def build_compra_id(
    uasg: str | int, number: str | int, year: int, modality: str = PREGAO_MODALITY
) -> str:
    """UASG(6) + modality(2) + number(5) + year(4)."""
    uasg_s = str(uasg).zfill(6)
    number_s = str(int(number)).zfill(5)
    if len(uasg_s) != 6 or len(number_s) != 5 or len(modality) != 2:
        raise ComprasnetScrapeError(
            f"cannot build compra id from uasg={uasg!r} number={number!r} modality={modality!r}"
        )
    return f"{uasg_s}{modality}{number_s}{year:04d}"


def acompanhamento_url(compra_id: str) -> str:
    return f"{PUBLIC_PAGE}?compra={compra_id}"


def is_api_url(url: str) -> bool:
    return url.startswith(BASE_URL) and any(s in url for s in API_SERVICES)


def extract_captcha_token(url: str) -> str | None:
    """The SPA appends `?captcha=<hcaptcha token>` to every public call."""
    token = parse_qs(urlparse(url).query).get("captcha", [""])[0]
    return token or None


_UNSAFE = re.compile(r"[^A-Za-z0-9._-]+")


def endpoint_slug(url: str) -> str:
    """Stable file-name stem for a captured URL: service + path, query dropped
    (the captcha token must never land on disk)."""
    parsed = urlparse(url)
    path = parsed.path
    for prefix in ("/comprasnet-fase-externa", "/comprasnet-disputa", "/comprasnet-mensagem"):
        if path.startswith(prefix):
            path = prefix.split("-", 1)[1] + path[len(prefix) :]
            break
    slug = _UNSAFE.sub("_", path.strip("/")).strip("_")
    return slug[:180] or "root"


def as_list(payload: Any) -> list[Any]:
    """Public list endpoints come back either as a bare list or as an
    envelope; keep every plausible envelope key rather than guessing one."""
    if payload is None:
        return []
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for key in (
            "content",
            "data",
            "itens",
            "items",
            "resultado",
            "registros",
            "lances",
            "propostas",
            "mensagens",
        ):
            value = payload.get(key)
            if isinstance(value, list):
                return value
    return []


def item_number(item: Any) -> int | None:
    if not isinstance(item, dict):
        return None
    for key in ("numero", "numeroItem", "numero_item", "item"):
        value = item.get(key)
        if isinstance(value, int):
            return value
        if isinstance(value, str) and value.isdigit():
            return int(value)
    return None


@dataclass
class ScrapeResult:
    compra_id: str
    out_dir: Path
    token_reusable: bool | None = None
    files: list[str] = field(default_factory=list)
    item_numbers: list[int] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    mode: str = "pending"  # token | passive | timeout
    engine: str = DEFAULT_ENGINE

    def summary(self) -> dict[str, Any]:
        return {
            "compra_id": self.compra_id,
            "url": acompanhamento_url(self.compra_id),
            "mode": self.mode,
            "engine": self.engine,
            "token_reusable": self.token_reusable,
            "items": self.item_numbers,
            "files": sorted(self.files),
            "errors": self.errors,
            "scraped_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        }


class _RawStore:
    """Writes one JSON file per captured response; same endpoint twice gets a
    numeric suffix so pagination and re-fetches never overwrite each other."""

    def __init__(self, raw_dir: Path) -> None:
        self.raw_dir = raw_dir
        self.raw_dir.mkdir(parents=True, exist_ok=True)
        self._seen: dict[str, int] = {}
        self.files: list[str] = []

    def save(self, url: str, payload: Any) -> str:
        slug = endpoint_slug(url)
        n = self._seen.get(slug, 0)
        self._seen[slug] = n + 1
        name = f"{slug}.json" if n == 0 else f"{slug}.{n}.json"
        path = self.raw_dir / name
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=1))
        self.files.append(str(path.relative_to(self.raw_dir.parent)))
        return name


def _harvest_plan(compra_id: str, token: str) -> list[tuple[str, dict[str, str]]]:
    """Compra-level GETs; item-level ones are added once items are known."""
    q = {"captcha": token}
    return [
        (f"{FASE_EXTERNA}/public/v1/compras/{compra_id}", q),
        (f"{FASE_EXTERNA}/public/v1/compras/{compra_id}/quadro-informativo", q),
        (
            f"{MENSAGEM}/v2/chat/{compra_id}",
            {**q, "legadoAsp": "false", "pagina": "1", "tamanhoPagina": str(PAGE_SIZE)},
        ),
    ]


def _item_plan(compra_id: str, number: int, token: str) -> list[tuple[str, dict[str, str]]]:
    q = {"captcha": token}
    paged = {**q, "pagina": "1", "tamanhoPagina": str(PAGE_SIZE)}
    return [
        (f"{FASE_EXTERNA}/public/v1/compras/{compra_id}/itens/{number}/detalhamento", q),
        (f"{FASE_EXTERNA}/public/v1/compras/{compra_id}/itens/{number}/propostas-iniciais", paged),
        (f"{FASE_EXTERNA}/public/v1/compras/{compra_id}/itens/{number}/propostas", q),
        (f"{DISPUTA}/v1/compras/{compra_id}/itens/{number}/lances", paged),
        (f"{DISPUTA}/v1/compras/{compra_id}/itens/{number}/lances/por-participante", paged),
    ]


async def _get_json(request_ctx: Any, url: str, params: dict[str, str]) -> tuple[int, Any]:
    resp = await request_ctx.get(url, params=params, headers={"Accept": "application/json"})
    status = resp.status
    if status != 200:
        return status, None
    try:
        return status, await resp.json()
    except Exception:  # noqa: BLE001 — non-JSON 200 (PDF/zip) is not an error here
        return status, None


async def _paged(request_ctx: Any, url: str, params: dict[str, str], store: _RawStore) -> list[Any]:
    """Follow `pagina` until a short page; keeps every page on disk."""
    rows: list[Any] = []
    if "pagina" not in params:
        status, payload = await _get_json(request_ctx, url, params)
        if status == 200:
            store.save(url, payload)
            return as_list(payload) or ([payload] if payload is not None else [])
        raise ComprasnetScrapeError(f"HTTP {status} {endpoint_slug(url)}")
    for page in range(1, MAX_PAGES + 1):
        status, payload = await _get_json(request_ctx, url, {**params, "pagina": str(page)})
        if status != 200:
            if page == 1:
                raise ComprasnetScrapeError(f"HTTP {status} {endpoint_slug(url)}")
            break
        store.save(url, payload)
        chunk = as_list(payload)
        rows.extend(chunk)
        if len(chunk) < int(params["tamanhoPagina"]):
            break
    return rows


async def _wait_for_token(page: Any, deadline: float) -> str | None:
    """First SPA request to one of the API services carrying a non-empty
    `captcha=` means the operator solved the challenge."""
    loop = asyncio.get_running_loop()
    future: asyncio.Future[str] = loop.create_future()

    def on_request(req: Any) -> None:
        if future.done() or not is_api_url(req.url):
            return
        token = extract_captcha_token(req.url)
        if token:
            future.set_result(token)

    page.on("request", on_request)
    try:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return None
        return await asyncio.wait_for(future, timeout=remaining)
    except TimeoutError:
        return None
    finally:
        page.remove_listener("request", on_request)


async def _stdin_enter(prompt: str) -> None:
    print(prompt, file=sys.stderr, flush=True)
    await asyncio.get_running_loop().run_in_executor(None, sys.stdin.readline)


VIEWPORT = {"width": 1280, "height": 900}


@asynccontextmanager
async def _open_context(engine: str, profile_dir: Path | None) -> AsyncIterator[Any]:
    """Yield a headed Playwright BrowserContext for the chosen engine and tear
    everything down on exit. Persistent profile when `profile_dir` is given,
    so hCaptcha's accessibility/trust cookies survive between runs."""
    if profile_dir is not None:
        profile_dir.mkdir(parents=True, exist_ok=True)

    if engine == "camoufox":
        try:
            from camoufox.async_api import AsyncCamoufox
        except ImportError as exc:  # pragma: no cover - import guard
            raise ComprasnetScrapeError(
                "camoufox is not installed — run `uv sync --extra scrape && "
                "python -m camoufox fetch`"
            ) from exc
        options: dict[str, Any] = {
            "headless": False,
            "locale": "pt-BR",
            "os": "macos" if sys.platform == "darwin" else "linux",
            "humanize": True,
            "window": (VIEWPORT["width"], VIEWPORT["height"]),
        }
        if profile_dir is not None:
            options.update(persistent_context=True, user_data_dir=str(profile_dir))
        async with AsyncCamoufox(**options) as handle:
            if profile_dir is not None:
                yield handle  # BrowserContext
            else:
                context = await handle.new_context(locale="pt-BR", viewport=VIEWPORT)
                try:
                    yield context
                finally:
                    await context.close()
        return

    try:
        from playwright.async_api import async_playwright
    except ImportError as exc:  # pragma: no cover - import guard
        raise ComprasnetScrapeError(
            "playwright is not installed — run `uv sync --extra scrape && playwright install chromium`"
        ) from exc
    async with async_playwright() as pw:
        launch = {"headless": False, "args": ["--lang=pt-BR"]}
        if profile_dir is not None:
            context = await pw.chromium.launch_persistent_context(
                str(profile_dir), locale="pt-BR", viewport=VIEWPORT, **launch
            )
            try:
                yield context
            finally:
                await context.close()
            return
        browser = await pw.chromium.launch(**launch)
        context = await browser.new_context(locale="pt-BR", viewport=VIEWPORT)
        try:
            yield context
        finally:
            await context.close()
            await browser.close()


async def scrape_async(
    compra_id: str,
    out_dir: Path,
    *,
    timeout_s: float = 600.0,
    profile_dir: Path | None = None,
    passive_only: bool = False,
    engine: str = DEFAULT_ENGINE,
) -> ScrapeResult:
    if engine not in ENGINES:
        raise ComprasnetScrapeError(f"unknown engine {engine!r}; expected one of {ENGINES}")

    out_dir.mkdir(parents=True, exist_ok=True)
    store = _RawStore(out_dir / "raw")
    result = ScrapeResult(compra_id=compra_id, out_dir=out_dir, engine=engine)
    url = acompanhamento_url(compra_id)
    deadline = time.monotonic() + timeout_s

    async with _open_context(engine, profile_dir) as context:
        page = context.pages[0] if context.pages else await context.new_page()

        # Passive capture of everything the SPA itself fetches, start to finish.
        async def on_response(resp: Any) -> None:
            if not is_api_url(resp.url) or resp.status != 200:
                return
            if "json" not in (resp.headers.get("content-type") or ""):
                return
            try:
                store.save(resp.url, await resp.json())
            except Exception as exc:  # noqa: BLE001 — body may be gone (navigation)
                log.debug("drop %s: %s", resp.url, exc)

        page.on("response", on_response)

        print(
            f"\nOpening {url}\nSolve the hCaptcha in the browser window. Waiting up to "
            f"{int(timeout_s)} s…",
            file=sys.stderr,
            flush=True,
        )
        await page.goto(url, wait_until="domcontentloaded", timeout=60_000)
        token = await _wait_for_token(page, deadline)
        if token is None:
            result.mode = "timeout"
            result.errors.append("no authorised request seen before timeout (captcha unsolved?)")
        elif passive_only:
            result.mode = "passive"
        else:
            result.mode = "token"
            try:
                await _harvest(context.request, compra_id, token, store, result)
                result.token_reusable = True
            except ComprasnetScrapeError as exc:
                result.token_reusable = False
                result.errors.append(f"token reuse refused: {exc}")
                result.mode = "passive"

        if result.mode == "passive":
            await _stdin_enter(
                "Passive mode: click through items / lances / propostas / chat in the "
                "window; every JSON the page loads is saved. Press Enter here when done."
            )
        # Let late responses land before closing.
        await page.wait_for_timeout(1500)
        page.remove_listener("response", on_response)

    result.files = store.files
    (out_dir / "summary.json").write_text(
        json.dumps(result.summary(), ensure_ascii=False, indent=1)
    )
    return result


async def _harvest(
    request_ctx: Any, compra_id: str, token: str, store: _RawStore, result: ScrapeResult
) -> None:
    # Items first: a refusal here is the cheapest signal that the token is single-use.
    itens_url = f"{FASE_EXTERNA}/public/v1/compras/{compra_id}/itens"
    itens = await _paged(
        request_ctx,
        itens_url,
        {"captcha": token, "pagina": "1", "tamanhoPagina": str(PAGE_SIZE)},
        store,
    )
    numbers = sorted({n for n in (item_number(i) for i in itens) if n is not None})
    result.item_numbers = numbers
    log.info("compra %s: %d items", compra_id, len(numbers))

    for url, params in _harvest_plan(compra_id, token):
        try:
            await _paged(request_ctx, url, params, store)
        except ComprasnetScrapeError as exc:
            result.errors.append(str(exc))

    for number in numbers:
        for url, params in _item_plan(compra_id, number, token):
            try:
                await _paged(request_ctx, url, params, store)
            except ComprasnetScrapeError as exc:
                result.errors.append(str(exc))
            await asyncio.sleep(0.3)


def scrape(
    compra: str,
    out_dir: Path,
    *,
    timeout_s: float = 600.0,
    profile_dir: Path | None = None,
    passive_only: bool = False,
    engine: str = DEFAULT_ENGINE,
) -> ScrapeResult:
    compra_id = parse_compra_id(compra)
    return asyncio.run(
        scrape_async(
            compra_id,
            out_dir,
            timeout_s=timeout_s,
            profile_dir=profile_dir,
            passive_only=passive_only,
            engine=engine,
        )
    )
