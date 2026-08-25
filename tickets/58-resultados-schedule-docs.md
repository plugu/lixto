---
id: 58
status: done
model: haiku
depends_on: [55]
max_attempts: 3
files:
  - src/plic/schedule.py
  - tests/test_schedule.py
  - README.md
  - docs/PNCP_API.md
---
## Goal
Make the results queue drain on its own (twice daily, after the incremental sync) and document the endpoint, the command and the new columns.

## Context

Without this the queue filled by the web page is never drained and the price block stays permanently on "Coletando…".

### `src/plic/schedule.py`

`generate_plist()` currently builds `ProgramArguments` as a direct `uv run plic sync incremental` invocation. Change **only** that value so the job runs the incremental sync and then drains the results queue:

```python
"ProgramArguments": [
    "/bin/sh",
    "-lc",
    f"{uv_path} run plic sync incremental && {uv_path} run plic sync resultados --limit 2000",
],
```

Use the existing `get_uv_path()` / `get_repo_path()` helpers for the paths exactly as the current code does — do not inline new path logic. Every other plist key (`Label`, `StartCalendarInterval`, working directory, log paths) stays byte-identical. `--limit 2000` is ~17 minutes at the 2 req/s self-imposed rate, which fits comfortably between the 07:00 and 19:00 runs.

Update `tests/test_schedule.py` where it asserts on `ProgramArguments`; leave every other assertion alone.

### `README.md`

Under "### Sync", add:
`plic sync resultados [--limit N]` — Fetch homologated results (winner + unit price) for itens queued by the dashboard.

Then a short subsection explaining the demand-driven policy: the dashboard marks `item.resultados_solicitados_em` when a user opens a licitação; this command drains that queue and stamps `item.resultados_sincronizados_em` (set even when PNCP publishes no result, so it is not retried forever). State plainly why there is no mass backfill: 4.06M itens of homologated licitações at 2 req/s is ~23 days.

Under "### Tables", add `resultado` — homologated results per item (winner CNPJ, razão social, porte, unit price, discount, date).

### `docs/PNCP_API.md`

Add a section next to the existing `/itens` and `/arquivos` entries:

`GET /api/pncp/v1/orgaos/{cnpj}/compras/{ano}/{sequencial}/itens/{numeroItem}/resultados` — homologated results per item. Bare JSON array of `RecuperarCompraItemResultadoDTO`. Verified live 2026-08-24 (HTTP 200 on `42498600000171/2026/2592` item 1).

**Document this trap prominently — it is the sharpest edge found this cycle.** Unlike `/itens` and `/arquivos`, this endpoint does **not** implement pagination: the `pagina` parameter is ignored, and pages 2, 3, … 200+ all echo page 1's exact content back with HTTP 200 — never a 404, 204 or `200 []`. Confirmed independently twice (a same-day result and a historical one from April 2026, and again by direct curl at `pagina=5`). A generic paginator loops forever here. `src/plic/sync_resultados.py` handles it with a `_FirstPageOnly` client wrapper; anyone adding a future crawl must know results are effectively single-page.

List the promoted DTO fields in the same style as the existing "Key DTO fields" section: `numeroItem`, `sequencialResultado`, `niFornecedor`, `nomeRazaoSocialFornecedor`, `tipoPessoa`, `porteFornecedorId/Nome`, `quantidadeHomologada`, `valorUnitarioHomologado`, `valorTotalHomologado`, `percentualDesconto`, `ordemClassificacaoSrp`, `situacaoCompraItemResultadoId/Nome`, `indicadorSubcontratacao`, `dataResultado`, `dataCancelamento`, `motivoCancelamento`, `dataInclusao`, `dataAtualizacao`. Note that `reservaRemanescente` is a nested `{codigo, nome}` object and is not stored.

Also record the measured fact that `catalogoCodigoItem` is present on only 0.25% of itens and `ncmNbsCodigo` on 3% (measured 2026-08-24, 7,856,405 rows) — that is why price comparison goes through the description, and the next person to look for a catalog join key should not have to rediscover it.

## Checks (run in order — cheapest first)
1. `uv run ruff check`
2. `uv run pytest tests/test_schedule.py`
3. `uv run pytest`
4. `uv run plic schedule install --dry-run` — exits 0 and the printed plist contains `sync resultados`.

## Done when
- The generated plist runs `sync incremental` followed by `sync resultados --limit 2000`.
- README documents the command, the queue columns and why there is no mass backfill.
- `docs/PNCP_API.md` documents the `/resultados` endpoint and the CATMAT sparsity finding.

## Not included
- A separate launchd job or a different schedule — reuse the existing `com.plic.sync` job.
- Any change to `src/plic/sync_resultados.py`, `src/plic/cli.py` or the web app.
- Linux/systemd support.
