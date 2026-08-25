---
id: 55
status: done
model: sonnet
depends_on: []
max_attempts: 3
files:
  - migrations/009_resultado.sql
  - src/plic/sync_resultados.py
  - src/plic/cli.py
  - tests/test_sync_resultados.py
---
## Goal
Persist PNCP item results (winner CNPJ + homologated unit price) in a new `resultado` table, filled by `plic sync resultados`, which drains a demand queue kept on `item`.

## Context

Endpoint verified live 2026-08-24, HTTP 200, bare JSON array:
`GET https://pncp.gov.br/api/pncp/v1/orgaos/{cnpj}/compras/{ano}/{sequencial}/itens/{numeroItem}/resultados`

Real payload fields (`RecuperarCompraItemResultadoDTO`): `numeroItem`, `sequencialResultado`, `niFornecedor`, `nomeRazaoSocialFornecedor`, `tipoPessoa`, `porteFornecedorId`, `porteFornecedorNome`, `quantidadeHomologada`, `valorUnitarioHomologado`, `valorTotalHomologado`, `percentualDesconto`, `ordemClassificacaoSrp`, `situacaoCompraItemResultadoId`, `situacaoCompraItemResultadoNome`, `indicadorSubcontratacao`, `dataResultado`, `dataCancelamento`, `motivoCancelamento`, `dataInclusao`, `dataAtualizacao`. `reservaRemanescente` is a nested `{codigo, nome}` object — ignore it, it is not stored.

### `migrations/009_resultado.sql`

Plain-SQL migration, same pattern as `migrations/008_cnae.sql` (runner in `src/plic/db.py`, applied by `plic db init`):

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS resultado (
    numero_controle_pncp TEXT NOT NULL,
    numero_item INTEGER NOT NULL,
    sequencial_resultado INTEGER NOT NULL,
    ni_fornecedor TEXT,
    nome_razao_social_fornecedor TEXT,
    tipo_pessoa TEXT,
    porte_fornecedor_id INTEGER,
    porte_fornecedor_nome TEXT,
    quantidade_homologada NUMERIC,
    valor_unitario_homologado NUMERIC,
    valor_total_homologado NUMERIC,
    percentual_desconto NUMERIC,
    ordem_classificacao_srp INTEGER,
    situacao_compra_item_resultado_id INTEGER,
    situacao_compra_item_resultado_nome TEXT,
    indicador_subcontratacao BOOLEAN,
    data_resultado DATE,
    data_cancelamento TIMESTAMPTZ,
    motivo_cancelamento TEXT,
    data_inclusao TIMESTAMPTZ,
    data_atualizacao TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (numero_controle_pncp, numero_item, sequencial_resultado)
);
CREATE INDEX IF NOT EXISTS idx_resultado_ni_fornecedor ON resultado (ni_fornecedor);
CREATE INDEX IF NOT EXISTS idx_resultado_lookup
  ON resultado (numero_controle_pncp, numero_item);

ALTER TABLE item ADD COLUMN IF NOT EXISTS resultados_sincronizados_em TIMESTAMPTZ;
ALTER TABLE item ADD COLUMN IF NOT EXISTS resultados_solicitados_em TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_item_resultados_fila
  ON item (resultados_solicitados_em)
  WHERE resultados_solicitados_em IS NOT NULL AND resultados_sincronizados_em IS NULL;
```

Deliberate choices, do not "improve" them:
- **No `raw` column.** `item.raw` already costs 15 GB of the 18 GB database; results are promoted columns only.
- **No foreign key** `resultado → item`. Validating one would lock a 7.85M-row table on every `db init`.
- Both `ALTER TABLE item ADD COLUMN` are nullable with no default, so they are metadata-only on Postgres 16 — instant even at 7.85M rows. The partial index build does scan the table once (expect a few minutes on first `db init`); that is accepted.

### `src/plic/sync_resultados.py`

Mirror `src/plic/sync_detalhes.py` closely — same module docstring style, same logging, same error handling.

- `BASE_URL_PNCP = "https://pncp.gov.br/api/pncp"`.
- Reuse the paginator: `from plic.sync_detalhes import _fetch_bare_array_pages`. It already handles 404-on-first-page → `[]`, HTTP 204 → end of pages, and `200 []` → end of pages. Do not reimplement it.
- `fetch_resultados(client, *, orgao_cnpj, ano_compra, sequencial_compra, numero_item) -> list[dict]` builds
  `/v1/orgaos/{orgao_cnpj}/compras/{ano_compra}/{sequencial_compra}/itens/{numero_item}/resultados`.
- `row_from_resultado_dto(numero_controle_pncp, dto) -> dict` — pure, `dto["sequencialResultado"]` and `dto["numeroItem"]` are required keys, everything else `.get()`. Same shape/style as `row_from_item_dto`.
- `upsert_resultado(cursor, numero_controle_pncp, dto)` — `INSERT ... ON CONFLICT (numero_controle_pncp, numero_item, sequencial_resultado) DO UPDATE SET ...` updating every non-key column plus `updated_at = now()`.
- `sync_resultados(conn, *, limit=None, client=None) -> int` — returns the number of items processed (stamped).

Queue selection SQL (this is the whole crawl policy — **only user-requested items are fetched, never a speculative backlog**; a full crawl of the 4.06M homologated items would take ~23 days at 2 req/s):

```sql
SELECT i.numero_controle_pncp, i.numero_item,
       l.orgao_cnpj, l.ano_compra, l.sequencial_compra
FROM item i
JOIN licitacao l ON l.numero_controle_pncp = i.numero_controle_pncp
WHERE i.resultados_solicitados_em IS NOT NULL
  AND i.resultados_sincronizados_em IS NULL
ORDER BY i.resultados_solicitados_em ASC
```
plus `LIMIT %(limit)s` when `limit` is not None — same `_select_pending_licitacoes` shape as `sync_detalhes.py`.

Per item: fetch, upsert every returned DTO, then always
`UPDATE item SET resultados_sincronizados_em = now(), updated_at = now() WHERE numero_controle_pncp = %s AND numero_item = %s` — **stamp even when the array is empty**, so an item with genuinely no published result is not re-fetched forever. Commit per item. One item failing after client retries is `logger.exception`-ed and skipped, never fatal (same as `sync_detalhes`).

### `src/plic/cli.py`

Add `@sync_app.command("resultados")` / `def sync_resultados_cmd(limit: int = _LIMIT_OPTION) -> None` immediately after `sync_detalhes_cmd`, copying its body structure (open connection, call, print the count).

### `tests/test_sync_resultados.py`

Mirror `tests/test_sync_detalhes.py` — mocked `PncpClient` and mocked `psycopg.Connection`, no network, no live DB. Cover:
- `row_from_resultado_dto` maps the live payload above field-by-field, and ignores `reservaRemanescente`.
- an empty result array still stamps `resultados_sincronizados_em`.
- a 404 on the first page yields zero rows and still stamps.
- one item raising `PncpApiError` is skipped and the next item still processes.
- `limit` reaches the SQL as a bound parameter.

## Checks (run in order — cheapest first)
1. `uv run ruff check`
2. `uv run pytest tests/test_sync_resultados.py`
3. `uv run pytest`
4. `uv run plic db init`
5. `docker compose exec -T db psql -U plic -d plic -c "UPDATE item SET resultados_solicitados_em = now(), resultados_sincronizados_em = NULL WHERE numero_controle_pncp = '42498600000171-1-002592/2026'"`
6. `uv run plic sync resultados --limit 20`
7. `docker compose exec -T db psql -U plic -d plic -t -A -c "SELECT count(*) FROM resultado"` — must print a number greater than 0.

## Done when
- `resultado` holds real rows for `42498600000171-1-002592/2026` with a non-null `valor_unitario_homologado` and `ni_fornecedor`.
- Re-running `plic sync resultados` right after is a no-op (queue drained, everything stamped).

## Not included
- Any web/TypeScript change (tickets 56, 57).
- Scheduler wiring and docs (ticket 58).
- Any speculative/backlog crawl beyond the requested queue.
- Storing the raw DTO JSON.
