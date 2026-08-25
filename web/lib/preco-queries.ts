// Preço-alvo (ticket 56): per item of a licitação, the median homologated unit
// price of comparable historical items, plus p25–p75, sample size and the last
// winners — and the enqueue of the historical items whose resultados we still
// have to collect.
//
// Comparable items are matched by DESCRIPTION, not by catalog code:
// `catalogo_codigo_item` (CATMAT/CATSER) is filled on 19.714 of 7.856.405 itens
// (0,25%) and NCM on 3% — measured on the live database on 2026-08-24. There is
// no usable catalog key.
//
// Every value from the outside world is bound as a parameterized placeholder —
// never string-interpolated into SQL text.

import { pool } from "./db";

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
  /** at most 3, most recent first, deduplicated by ni_fornecedor */
  vencedores: Vencedor[];
};

/** Below this many comparable samples we show no number at all — a median of
 * two samples is a lie (PRODUCT.md commits to not showing it). */
const N_MINIMO = 5;

/** Words that carry no discriminating power in a Brazilian item description. */
const STOP_WORDS = new Set([
  "para",
  "com",
  "sem",
  "tipo",
  "unidade",
  "medida",
  "marca",
  "conforme",
  "aproximadamente",
  "referencia",
  "descricao",
  "item",
  "servico",
  "servicos",
  "material",
  "materiais",
]);

/**
 * Turns an item description into the two `to_tsquery('portuguese', ...)` inputs
 * used to find comparable items: `primary` (first 6 tokens, precise) and
 * `fallback` (first 3 tokens, broader), both AND-joined.
 *
 * Pure on purpose: this is the unit-testable core of the matching rule.
 */
export function buildTsQuery(descricao: string | null): {
  primary: string | null;
  fallback: string | null;
} {
  if (!descricao) return { primary: null, fallback: null };
  const tokens = descricao
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length >= 4 && !STOP_WORDS.has(token));
  if (tokens.length === 0) return { primary: null, fallback: null };
  return {
    primary: tokens.slice(0, 6).join(" & "),
    fallback: tokens.slice(0, 3).join(" & "),
  };
}

// --- SQL -------------------------------------------------------------------

// Matches the expression of idx_item_descricao_fts_unaccent (migration 005),
// so the GIN index is usable.
const FTS_MATCH = `to_tsvector('portuguese', f_unaccent(coalesce(hist.descricao, '')))
             @@ to_tsquery('portuguese', alvo.tsq)`;

// Same unit of measure when both sides have one; passes when either is NULL.
const MESMA_UNIDADE = `(hist.unidade_medida IS NULL OR alvo.unidade_medida IS NULL
              OR lower(btrim(hist.unidade_medida)) = lower(btrim(alvo.unidade_medida)))`;

// The LIMIT 200 inside the LATERAL is load-bearing: an unbounded GIN match over
// 7,85M itens is the one thing that makes the detail page unusable.
const BENCHMARK_SQL = `
  WITH alvo AS (
    SELECT t.numero_item, t.tsq, i.unidade_medida
    FROM unnest($2::int[], $3::text[]) AS t(numero_item, tsq)
    JOIN item i
      ON i.numero_controle_pncp = $1 AND i.numero_item = t.numero_item
  ),
  comp AS (
    SELECT alvo.numero_item, c.*
    FROM alvo
    CROSS JOIN LATERAL (
      SELECT r.valor_unitario_homologado,
             r.data_resultado,
             r.ni_fornecedor,
             r.nome_razao_social_fornecedor,
             r.porte_fornecedor_nome
      FROM item hist
      JOIN resultado r
        ON r.numero_controle_pncp = hist.numero_controle_pncp
       AND r.numero_item = hist.numero_item
      WHERE hist.numero_controle_pncp <> $1
        AND ${FTS_MATCH}
        AND ${MESMA_UNIDADE}
        AND r.valor_unitario_homologado > 0
        AND r.data_cancelamento IS NULL
        AND r.data_resultado >= current_date - interval '24 months'
        AND (r.ordem_classificacao_srp IS NULL OR r.ordem_classificacao_srp = 1)
      ORDER BY r.data_resultado DESC
      LIMIT 200
    ) c
  ),
  agg AS (
    SELECT numero_item,
           count(*)::int AS n,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY valor_unitario_homologado)::text AS mediana,
           percentile_cont(0.25) WITHIN GROUP (ORDER BY valor_unitario_homologado)::text AS p25,
           percentile_cont(0.75) WITHIN GROUP (ORDER BY valor_unitario_homologado)::text AS p75
    FROM comp
    GROUP BY numero_item
  ),
  recentes AS (
    SELECT numero_item, ni_fornecedor, nome_razao_social_fornecedor,
           porte_fornecedor_nome, valor_unitario_homologado, data_resultado,
           row_number() OVER (
             PARTITION BY numero_item ORDER BY data_resultado DESC NULLS LAST
           ) AS rn
    FROM comp
  ),
  venc AS (
    SELECT numero_item,
           json_agg(json_build_object(
             'ni_fornecedor', ni_fornecedor,
             'nome_razao_social_fornecedor', nome_razao_social_fornecedor,
             'porte_fornecedor_nome', porte_fornecedor_nome,
             'valor_unitario_homologado', valor_unitario_homologado::text,
             'data_resultado', data_resultado
           ) ORDER BY data_resultado DESC NULLS LAST) AS vencedores
    FROM recentes
    WHERE rn <= 20
    GROUP BY numero_item
  )
  SELECT alvo.numero_item,
         coalesce(agg.n, 0) AS n,
         agg.mediana,
         agg.p25,
         agg.p75,
         venc.vencedores,
         EXISTS (
           SELECT 1
           FROM item hist
           WHERE hist.numero_controle_pncp <> $1
             AND ${FTS_MATCH}
             AND ${MESMA_UNIDADE}
             AND hist.resultados_solicitados_em IS NOT NULL
             AND hist.resultados_sincronizados_em IS NULL
         ) AS pendente
  FROM alvo
  LEFT JOIN agg ON agg.numero_item = alvo.numero_item
  LEFT JOIN venc ON venc.numero_item = alvo.numero_item
`;

// Same LATERAL match, but selecting historical itens that have no resultado row
// yet. Bounded to 40 per target item — lazy fill, not an open crawl.
const ENQUEUE_SQL = `
  UPDATE item SET resultados_solicitados_em = now()
  WHERE (numero_controle_pncp, numero_item) IN (
    SELECT c.numero_controle_pncp, c.numero_item
    FROM (
      SELECT t.numero_item, t.tsq, i.unidade_medida
      FROM unnest($2::int[], $3::text[]) AS t(numero_item, tsq)
      JOIN item i
        ON i.numero_controle_pncp = $1 AND i.numero_item = t.numero_item
    ) alvo
    CROSS JOIN LATERAL (
      SELECT hist.numero_controle_pncp, hist.numero_item
      FROM item hist
      WHERE hist.numero_controle_pncp <> $1
        AND ${FTS_MATCH}
        AND ${MESMA_UNIDADE}
        AND hist.resultados_sincronizados_em IS NULL
        AND hist.resultados_solicitados_em IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM resultado r
          WHERE r.numero_controle_pncp = hist.numero_controle_pncp
            AND r.numero_item = hist.numero_item
        )
      LIMIT 40
    ) c
  )
  AND resultados_solicitados_em IS NULL
`;

// --- row shapes as pg returns them -----------------------------------------

type AlvoRow = { numero_item: number; descricao: string | null };

// data_resultado arrives as a 'YYYY-MM-DD' string because it is built by
// json_build_object, not decoded as a pg date.
type VencedorRaw = {
  ni_fornecedor: string | null;
  nome_razao_social_fornecedor: string | null;
  porte_fornecedor_nome: string | null;
  valor_unitario_homologado: string | null;
  data_resultado: string | Date | null;
};

type BenchmarkRow = {
  numero_item: number;
  n: number;
  mediana: string | null;
  p25: string | null;
  p75: string | null;
  vencedores: VencedorRaw[] | null;
  pendente: boolean;
};

function toDate(value: string | Date | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  // Local midnight, same as node-pg's decoding of a bare DATE column.
  return match
    ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    : new Date(value);
}

function toVencedores(raw: VencedorRaw[] | null): Vencedor[] {
  if (!raw) return [];
  const ordenados = raw
    .map((v) => ({ ...v, data_resultado: toDate(v.data_resultado) }))
    .sort((a, b) => (b.data_resultado?.getTime() ?? 0) - (a.data_resultado?.getTime() ?? 0));
  const vistos = new Set<string>();
  const out: Vencedor[] = [];
  for (const v of ordenados) {
    if (v.ni_fornecedor !== null) {
      if (vistos.has(v.ni_fornecedor)) continue;
      vistos.add(v.ni_fornecedor);
    }
    out.push({
      ni_fornecedor: v.ni_fornecedor,
      nome_razao_social_fornecedor: v.nome_razao_social_fornecedor,
      porte_fornecedor_nome: v.porte_fornecedor_nome,
      valor_unitario_homologado: v.valor_unitario_homologado,
      data_resultado: v.data_resultado,
    });
    if (out.length === 3) break;
  }
  return out;
}

function toPrecoItem(row: BenchmarkRow): PrecoItem {
  const n = Number(row.n);
  const ok = n >= N_MINIMO;
  return {
    numero_item: row.numero_item,
    // Below the threshold the percentiles stay null on purpose.
    estado: ok ? "ok" : row.pendente ? "coletando" : "insuficiente",
    n,
    mediana: ok ? row.mediana : null,
    p25: ok ? row.p25 : null,
    p75: ok ? row.p75 : null,
    vencedores: toVencedores(row.vencedores),
  };
}

async function fetchAlvos(numeroControlePncp: string): Promise<AlvoRow[]> {
  const result = await pool.query<AlvoRow>(
    `SELECT numero_item, descricao
     FROM item
     WHERE numero_controle_pncp = $1
     ORDER BY numero_item ASC`,
    [numeroControlePncp],
  );
  return result.rows;
}

/**
 * Per item of the licitação, the median homologated unit price of comparable
 * historical items. Two aggregate queries at most, both batched over every item
 * — the precise one, then the broader `fallback` one for the items that came
 * back below the sample threshold. Never one query per item.
 */
export async function fetchPrecoBenchmark(
  numeroControlePncp: string,
): Promise<Map<number, PrecoItem>> {
  const alvos = await fetchAlvos(numeroControlePncp);
  const out = new Map<number, PrecoItem>();
  const numeros: number[] = [];
  const primarias: string[] = [];
  const fallbacks = new Map<number, string>();

  for (const alvo of alvos) {
    const { primary, fallback } = buildTsQuery(alvo.descricao);
    // No usable token: nothing to compare against, and no query to run.
    out.set(alvo.numero_item, {
      numero_item: alvo.numero_item,
      estado: "insuficiente",
      n: 0,
      mediana: null,
      p25: null,
      p75: null,
      vencedores: [],
    });
    if (primary === null) continue;
    numeros.push(alvo.numero_item);
    primarias.push(primary);
    // A fallback identical to the primary would just repeat the same work.
    if (fallback !== null && fallback !== primary) {
      fallbacks.set(alvo.numero_item, fallback);
    }
  }
  if (numeros.length === 0) return out;

  const primario = await pool.query<BenchmarkRow>(BENCHMARK_SQL, [
    numeroControlePncp,
    numeros,
    primarias,
  ]);
  for (const row of primario.rows) out.set(row.numero_item, toPrecoItem(row));

  const abaixo = primario.rows
    .filter((row) => Number(row.n) < N_MINIMO && fallbacks.has(row.numero_item))
    .map((row) => row.numero_item);
  if (abaixo.length === 0) return out;

  const largo = await pool.query<BenchmarkRow>(BENCHMARK_SQL, [
    numeroControlePncp,
    abaixo,
    abaixo.map((numeroItem) => fallbacks.get(numeroItem) as string),
  ]);
  for (const row of largo.rows) {
    const item = toPrecoItem(row);
    const anterior = out.get(row.numero_item);
    // The broader query can only widen the sample, but both are capped at 200
    // per target item — keep whichever actually found more.
    if (!anterior || item.n >= anterior.n) out.set(row.numero_item, item);
  }
  return out;
}

/**
 * Queues the comparable historical itens that have no resultado yet, so
 * `plic sync resultados` can fill them in. Safe to call on every page view:
 * already-queued and already-collected itens are excluded by the WHERE clause,
 * so repeated calls converge to zero. Returns the number of itens queued.
 */
export async function enqueueResultadosFaltantes(
  numeroControlePncp: string,
): Promise<number> {
  const alvos = await fetchAlvos(numeroControlePncp);
  const numeros: number[] = [];
  const consultas: string[] = [];
  for (const alvo of alvos) {
    const { primary } = buildTsQuery(alvo.descricao);
    if (primary === null) continue;
    numeros.push(alvo.numero_item);
    consultas.push(primary);
  }
  if (numeros.length === 0) return 0;

  const result = await pool.query(ENQUEUE_SQL, [
    numeroControlePncp,
    numeros,
    consultas,
  ]);
  return result.rowCount ?? 0;
}
