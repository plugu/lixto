---
id: 56
status: done
model: opus
depends_on: [55]
max_attempts: 3
files:
  - web/lib/preco-queries.ts
  - web/lib/preco-queries.test.ts
---
## Goal
Given a licitação, return per item the median homologated unit price of comparable historical items (with p25–p75, sample size and last winners), and enqueue the missing ones for collection.

## Context

This is the heart of the cycle and the only ticket where the matching rule is decided. Read `PRODUCT.md` first.

Why description matching and not a catalog code: `catalogo_codigo_item` (CATMAT/CATSER) is populated on only 19,714 of 7,856,405 itens (0.25%), NCM on 3%. Measured on the live database 2026-08-24. There is no usable catalog key.

What already exists and must be reused:
- `idx_item_descricao_fts_unaccent` — GIN on `to_tsvector('portuguese', f_unaccent(coalesce(descricao,'')))` (`migrations/005_unaccent_fts.sql`). `f_unaccent(text)` is an IMMUTABLE wrapper defined there.
- `pg_trgm` + the `resultado` table + `item.resultados_solicitados_em` / `item.resultados_sincronizados_em`, from ticket 55 / `migrations/009_resultado.sql`.
- `pool` from `web/lib/db.ts`. Follow `web/lib/detail-queries.ts` conventions: every outside value bound as `$n`, never interpolated; exported row types; one exported async function per query.
- Test style: mirror `web/lib/queries.test.ts` (vitest, mocked pool — no live DB in tests).

### Exports required

```ts
export type PrecoEstado = "ok" | "insuficiente" | "coletando";
export type Vencedor = {
  ni_fornecedor: string | null;
  nome_razao_social_fornecedor: string | null;
  porte_fornecedor_nome: string | null;
  valor_unitario_homologado: string | null;
  data_resultado: Date | null;
};
export type PrecoItem = {
  numero_item: number;
  estado: PrecoEstado;
  n: number;
  mediana: string | null;
  p25: string | null;
  p75: string | null;
  vencedores: Vencedor[];   // at most 3, most recent first
};
export function buildTsQuery(descricao: string | null): { primary: string | null; fallback: string | null };
export async function fetchPrecoBenchmark(numeroControlePncp: string): Promise<Map<number, PrecoItem>>;
export async function enqueueResultadosFaltantes(numeroControlePncp: string): Promise<number>;
```

### Matching rule (deterministic — implement exactly this, do not invent a scoring model)

`buildTsQuery` is a pure function, and the reason it is exported is that it is the unit-testable core:
1. lowercase, strip accents in JS (`normalize("NFD").replace(/\p{Diacritic}/gu,"")`), split on non-letter/digit.
2. drop tokens shorter than 4 characters and this stop list: `para, com, sem, tipo, unidade, medida, marca, conforme, aproximadamente, referencia, descricao, item, servico, servicos, material, materiais`.
3. `primary` = first 6 surviving tokens joined with ` & `; `fallback` = first 3 joined with ` & `. Fewer than 3 tokens → `fallback` uses whatever survives; zero tokens → both `null`.
4. Both feed `to_tsquery('portuguese', $n)`.

`fetchPrecoBenchmark` runs the aggregate query with `primary`; for any item that comes back with `n < 5`, re-runs it for those items with `fallback`. Two queries maximum, both batched over all items of the licitação — never one query per item.

Comparable rows are historical `item` rows joined to `resultado`, filtered by:
- `hist.numero_controle_pncp <> $1` (never compare a licitação to itself),
- FTS match against the target item's tsquery using the existing GIN index,
- same unit of measure when both sides have one: `lower(btrim(hist.unidade_medida)) = lower(btrim(alvo.unidade_medida))`, and pass when either is NULL,
- `r.valor_unitario_homologado > 0`, `r.data_cancelamento IS NULL`,
- `r.data_resultado >= current_date - interval '24 months'`,
- **winner only**: `r.ordem_classificacao_srp IS NULL OR r.ordem_classificacao_srp = 1`. An SRP (registro de preços) item stores every classified supplier as its own `sequencial_resultado`, ranked by `ordem_classificacao_srp`. Letting ranks 2, 3, … into the sample biases the median upward — those are the prices that *lost*.

Bound the work with `CROSS JOIN LATERAL (... ORDER BY r.data_resultado DESC LIMIT 200) c` per target item — an unbounded GIN match over 7.85M itens is the one thing that will make the detail page unusable. Aggregate with `percentile_cont(0.5|0.25|0.75) WITHIN GROUP (ORDER BY c.valor_unitario_homologado)`, `count(*)` for `n`.

Winners: at most 3 per item, most recent `data_resultado` first, deduplicated by `ni_fornecedor`.

### Estado

- `n >= 5` → `"ok"` (only then are `mediana`/`p25`/`p75` non-null; below the threshold return them as `null` — a median of two samples is a lie, and PRODUCT.md commits to not showing it).
- `n < 5` and at least one comparable historical item is queued but not yet collected (`resultados_solicitados_em IS NOT NULL AND resultados_sincronizados_em IS NULL`) → `"coletando"`.
- otherwise → `"insuficiente"`.

### `enqueueResultadosFaltantes`

Single statement, no read-then-write race:
`UPDATE item SET resultados_solicitados_em = now() WHERE (numero_controle_pncp, numero_item) IN (<same LATERAL match, but selecting hist items that have no resultado row and no resultados_sincronizados_em, LIMIT 40 per target item>) AND resultados_solicitados_em IS NULL`.
Returns `rowCount`. It must be safe to call on every page view: already-queued and already-collected items are excluded by the WHERE clause, so repeat calls converge to zero.

### Tests (`web/lib/preco-queries.test.ts`)

- `buildTsQuery`: accent stripping, short-token drop, stop-word drop, 6/3 token caps, empty/`null` descrição → `{primary: null, fallback: null}`.
- `fetchPrecoBenchmark` with a mocked pool: `n >= 5` → `estado "ok"` with percentiles; `n = 2` with pending queue rows → `"coletando"` and null percentiles; `n = 2` with nothing pending → `"insuficiente"`; fallback query fires only for the items below threshold.
- winners deduplicated by `ni_fornecedor` and capped at 3.
- `enqueueResultadosFaltantes` returns `rowCount` and binds `numeroControlePncp` as `$1`.

## Checks (run in order — cheapest first)
1. `cd web && npx tsc --noEmit`
2. `cd web && npm run lint`
3. `cd web && npm test`

## Done when
- `fetchPrecoBenchmark` returns one `PrecoItem` per item of the licitação, with `estado` set by the rule above.
- No SQL string interpolation: every outside value is a bound parameter.
- `enqueueResultadosFaltantes` called twice in a row returns 0 the second time.

## Not included
- Any React/UI change (ticket 57) — this ticket ships no component and does not touch the page.
- Embeddings, pgvector, ML price prediction.
- A `/precos` search screen or a `/concorrente/[cnpj]` profile.
- Changing `web/lib/detail-queries.ts`.
