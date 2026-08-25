---
id: 77
status: todo
model: sonnet
depends_on: [74]
max_attempts: 4
files:
  - src/lixto/sync/plans.py
  - src/lixto/cli/plans.py
  - tests/lixto/test_sync_plans.py
---
## Goal
`lixto plans sync` ingests Annual Procurement Plans (PCA) with their items from PNCP into `procurement_plans` / `procurement_plan_items`, incrementally by update date.

## Context

Read `docs/adr/001-lixto-data-model.md` (`procurement_plans`, `procurement_plan_items`, `agencies`, `source_payloads` entity `procurement_plan`, `sync_state`). Endpoint (PNCP OpenAPI, verified 2026-08-25): `GET https://pncp.gov.br/api/consulta/v1/pca/atualizacao?dataInicio=yyyyMMdd&dataFim=yyyyMMdd&pagina=N&tamanhoPagina=50` → envelope `{data: [PlanoContratacaoComItensDoUsuarioDTO], totalRegistros, totalPaginas, numeroPagina, paginasRestantes}`; 204 = empty. DTO: `idPcaPncp`, `orgaoEntidadeCnpj`, `orgaoEntidadeRazaoSocial`, `codigoUnidade`, `nomeUnidade`, `anoPca`, `dataPublicacaoPNCP`, `dataAtualizacaoGlobalPCA`, `itens: [PlanoContratacaoItemDTO]` with `numeroItem, categoriaItemPcaNome, classificacaoCatalogoId, nomeClassificacaoCatalogo, classificacaoSuperiorCodigo, classificacaoSuperiorNome, pdmCodigo, pdmDescricao, codigoItem, descricaoItem, unidadeFornecimento, quantidadeEstimada, valorUnitario, valorTotal, valorOrcamentoExercicio, unidadeRequisitante, dataDesejada, grupoContratacaoCodigo, grupoContratacaoNome, dataInclusao, dataAtualizacao`. Use `PncpClient.fetch_plans_update_page` (ticket 74). Mirror the structure of `src/lixto/sync/procurements.py`/`incremental.py` from ticket 75 if already merged, else of `src/plic/sync_incremental.py`. Wrap in `lixto.runs.run(conn, kind="sync.plans")`.

- Upsert `agencies` (from `orgaoEntidadeCnpj/RazaoSocial`; power/sphere NULL) before the plan.
- Upsert plan by `(source='pncp', source_id=idPcaPncp)` guarded by `source_global_updated_at`; replace its items (delete + insert inside the same transaction) and set `item_count`; write the whole DTO to `source_payloads` (`entity_type='procurement_plan'`).
- Watermark `sync_state` key `incremental:plans` = last `dataAtualizacaoGlobalPCA` seen; window paging in ≤ 7-day chunks from watermark (or `--since`) to today, page until `paginasRestantes == 0`.
- CLI `cli/plans.py`: `name="plans"`, `app` with `sync [--since YYYY-MM-DD] [--until]`.

### Tests
Mocked client + psycopg: DTO → row mapping (dates, numerics, NULLs), items replaced not appended, watermark advanced only after a chunk completes, 204 handled, agency upserted first.

## Checks (run in order — cheapest first)
1. `uv run ruff check src/lixto tests/lixto`
2. `uv run ruff format --check src/lixto tests/lixto`
3. `uv run pytest -q tests/lixto`
4. `uv run lixto plans sync --help | grep -q -- --since`
5. Live probe: `uv run lixto plans sync --since $(date -v-2d +%F)` exits 0 and `select count(*) from procurement_plan_items` > 0.

## Done when
- Plans and items for the last 2 days exist locally with `desired_date`/values populated; rerun is idempotent.

## Not included
- Web/tool exposure of plans; matching plans to companies.
