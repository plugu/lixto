---
id: 03
status: todo
model: sonnet
depends_on: [02]
max_attempts: 3
files:
  - src/plic/sync_detalhes.py
  - src/plic/cli.py
  - tests/test_sync_detalhes.py
  - tests/fixtures/itens.json
  - tests/fixtures/arquivos.json
---
## Goal
`plic sync detalhes` fetches items + edital/anexo metadata for licitações that don't have them yet.

## Context
Endpoints + DTOs: `docs/PNCP_API.md` (`/api/pncp/v1/orgaos/{cnpj}/compras/{ano}/{sequencial}/itens` and `/arquivos` — bare JSON arrays, page until empty; reuse `pncp_client.py` request/retry layer). Path params come from `licitacao.orgao_cnpj`, `ano_compra`, `sequencial_compra`.

Selection: licitações where `itens_sincronizados_em IS NULL` or `arquivos_sincronizados_em IS NULL`, ordered by `data_publicacao_pncp`, `--limit N` (default no limit). Per licitação: fetch, upsert (`ON CONFLICT` on the composite PKs, update all fields), set the respective `*_sincronizados_em = now()` even when the array is empty (empty is a valid answer; distinguishes "synced, none exist" from "never tried"). A 404 on either endpoint counts as synced-empty. One licitação failing (after retries) is logged and skipped, not fatal.

Store `documento.url` as given — never download the file.

Note from ticket 01: `item` columns were created as `situacao_compra_item_id/nome` and `tipo_beneficio_id/nome`, but the API returns `situacaoCompraItem` and `tipoBeneficio` as strings — verify against a live response and align the mapping (or migration 002) accordingly.

## Checks (run in order — cheapest first)
1. `uv run ruff check .`
2. `uv run pytest`
3. `docker compose up -d && uv run plic sync detalhes --limit 5 && docker compose exec -T db psql -U plic -d plic -tc 'select count(*) from item' | awk '{exit ($1>0)?0:1}'`

## Done when
- After ticket 02's probe data exists, `plic sync detalhes --limit 5` fills `item` and `documento` rows and stamps the licitações; rerun selects the next unstamped ones.
- Fixture tests: array paging, empty-array stamping, 404-as-empty, upsert idempotency.

## Not included
- No PDF downloads, no full-corpus loop (that's backfill), no parallel fetching.
