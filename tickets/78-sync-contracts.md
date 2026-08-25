---
id: 78
status: todo
model: sonnet
depends_on: [74]
max_attempts: 4
files:
  - src/lixto/sync/contracts.py
  - src/lixto/cli/contracts.py
  - tests/lixto/test_sync_contracts.py
---
## Goal
`lixto contracts sync` ingests public contracts and their amendments from PNCP into `contracts` / `contract_amendments`, linking to `procurements` when the originating procurement is known.

## Context

Read `docs/adr/001-lixto-data-model.md` (`contracts`, `contract_amendments`, `agencies`, `source_payloads` entities `contract` and `contract_amendments`, `sync_state`). Endpoints (PNCP OpenAPI, verified 2026-08-25):
- `GET https://pncp.gov.br/api/consulta/v1/contratos?dataInicial=yyyyMMdd&dataFinal=yyyyMMdd&pagina=N&tamanhoPagina=50` (by publication) and `/contratos/atualizacao` (by `dataAtualizacaoGlobal`) → `PaginaRetornoRecuperarContratoDTO`; 204 = empty.
- `GET https://pncp.gov.br/api/pncp/v1/orgaos/{cnpj}/contratos/{ano}/{sequencial}/termos?pagina=N&tamanhoPagina=50` → bare array of `RecuperarTermoContratoDTO`; 204 ends paging.
DTO field → column map is in the ADR comments (`RecuperarContratoDTO`: `numeroControlePNCP`, `numeroControlePncpCompra`, `numeroControlePncpAta`, `orgaoEntidade{cnpj,razaoSocial,poderId,esferaId}`, `unidadeOrgao{codigoUnidade,…}`, `anoContrato`, `sequencialContrato`, `numeroContratoEmpenho`, `processo`, `tipoContrato{id,nome}`, `categoriaProcesso{id,nome}`, `niFornecedor`, `nomeRazaoSocialFornecedor`, `tipoPessoa`, `codigoPaisFornecedor`, `niFornecedorSubContratado`, `nomeFornecedorSubContratado`, `objetoContrato`, `informacaoComplementar`, `receita`, `numeroParcelas`, `valorParcela`, `valorInicial`, `valorGlobal`, `valorAcumulado`, `dataAssinatura`, `dataVigenciaInicio`, `dataVigenciaFim`, `dataPublicacaoPncp`, `dataAtualizacao`, `dataAtualizacaoGlobal`, `frutoAdesao`, `emendaParlamentar`, `usuarioNome`; `RecuperarTermoContratoDTO`: `sequencialTermoContrato`, `numeroTermoContrato`, `tipoTermoContratoNome`, `objetoTermoContrato`, `fundamentoLegal`, `informativoObservacao`, `qualificacaoAcrescimoSupressao|Vigencia|Fornecedor|Reajuste` (→ `qualifiers` JSON), `valorAcrescido`, `numeroParcelas`, `valorParcela`, `valorGlobal`, `prazoAditadoDias`, `niFornecedor`, `nomeRazaoSocialFornecedor`, `dataAssinatura`, `dataVigenciaInicio`, `dataVigenciaFim`, `dataPublicacaoPncp`, `dataInclusao`, `dataAtualizacao`). Use `PncpClient.fetch_contracts_page` / `fetch_contract_amendments` (ticket 74). Wrap in `lixto.runs.run(conn, kind="sync.contracts")` / `"sync.amendments"`.

- Upsert `agencies`/`agency_units` first; upsert contract by `(source, source_id)` guarded by `source_global_updated_at`; resolve `procurement_id` = `SELECT id FROM procurements WHERE source='pncp' AND source_id = numeroControlePncpCompra` (NULL if absent); payload to `source_payloads` (`contract`).
- Amendments: for contracts with `amendments_synced_at IS NULL` (partial index) fetch `/termos`, replace rows, stamp; payload array to `source_payloads` (`contract_amendments`, `external_id = contract source_id`). Commit per contract.
- Watermark `incremental:contracts` on `dataAtualizacaoGlobal`; ≤ 7-day chunks; `--since` bootstrap.
- CLI `cli/contracts.py`: `name="contracts"`, `app` with `sync [--since] [--until] [--max-amendments N]` (contracts then amendments drain) and `amendments [--limit N]`.

### Tests
Mocked: DTO mapping incl. nested objects and booleans, `procurement_id` resolved/NULL, amendments replaced + stamped even when zero, watermark semantics, 204s.

## Checks (run in order — cheapest first)
1. `uv run ruff check src/lixto tests/lixto`
2. `uv run ruff format --check src/lixto tests/lixto`
3. `uv run pytest -q tests/lixto`
4. `uv run lixto contracts sync --help | grep -q -- --max-amendments`
5. Live probe: `uv run lixto contracts sync --since $(date -v-2d +%F) --max-amendments 10` exits 0; `select count(*) from contracts` > 0; `select count(*) from contract_amendments` ≥ 0 and `select count(*) from contracts where amendments_synced_at is not null` ≥ 1.

## Done when
- Contracts from the last 2 days exist with supplier and values; amendments fetched for at least the first N; reruns idempotent.

## Not included
- Contract files, invoices (`instrumentocobranca`), price registries (atas), web exposure.
