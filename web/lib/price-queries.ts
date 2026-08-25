// Price benchmark: per item of a procurement, the median awarded unit price of
// comparable historical items, plus p25–p75, sample size and the last winners —
// and the enqueue of the historical items whose results we still have to
// collect (`procurement_items.results_requested_at`).
//
// Comparable items are matched by DESCRIPTION, not by catalog code:
// `catalog_code` (CATMAT/CATSER) and NCM are filled on a negligible share of
// the PNCP item base, so there is no usable catalog key.
//
// Every value from the outside world is bound as a parameterized placeholder —
// never string-interpolated into SQL text.

import { pool } from "./db";

export type PriceState = "ok" | "insufficient" | "collecting";

export type Winner = {
  supplier_tax_id: string | null;
  supplier_name: string | null;
  supplier_size_name: string | null;
  awarded_unit_price: string | null;
  result_date: Date | null;
};

export type PriceItem = {
  item_number: number;
  state: PriceState;
  n: number;
  median: string | null;
  p25: string | null;
  p75: string | null;
  /** at most 3, most recent first, deduplicated by supplier_tax_id */
  winners: Winner[];
};

/** Below this many comparable samples we show no number at all — a median of
 * two samples is a lie (PRODUCT.md commits to not showing it). */
const MIN_SAMPLE = 5;

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
export function buildTsQuery(description: string | null): {
  primary: string | null;
  fallback: string | null;
} {
  if (!description) return { primary: null, fallback: null };
  const tokens = description
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

// Matches the expression of idx_procurement_items_description_fts
// (migrations/001_core.sql), so the GIN index is usable.
const FTS_MATCH = `to_tsvector('portuguese', f_unaccent(coalesce(hist.description, '')))
             @@ to_tsquery('portuguese', target.tsq)`;

// Same unit of measure when both sides have one; passes when either is NULL.
const SAME_UNIT = `(hist.unit IS NULL OR target.unit IS NULL
              OR lower(btrim(hist.unit)) = lower(btrim(target.unit)))`;

// The LIMIT 200 inside the LATERAL is load-bearing: an unbounded GIN match over
// millions of items is the one thing that makes the detail page unusable.
const BENCHMARK_SQL = `
  WITH target AS (
    SELECT t.item_number, t.tsq, i.unit
    FROM unnest($2::int[], $3::text[]) AS t(item_number, tsq)
    JOIN procurement_items i
      ON i.procurement_id = $1 AND i.item_number = t.item_number
  ),
  comp AS (
    SELECT target.item_number, c.*
    FROM target
    CROSS JOIN LATERAL (
      SELECT r.awarded_unit_price,
             r.result_date,
             r.supplier_tax_id,
             r.supplier_name,
             r.supplier_size_name
      FROM procurement_items hist
      JOIN procurement_results r
        ON r.procurement_id = hist.procurement_id
       AND r.item_number = hist.item_number
      WHERE hist.procurement_id <> $1
        AND ${FTS_MATCH}
        AND ${SAME_UNIT}
        AND r.awarded_unit_price > 0
        AND r.cancelled_at IS NULL
        AND r.result_date >= current_date - interval '24 months'
        AND (r.price_registry_rank IS NULL OR r.price_registry_rank = 1)
      ORDER BY r.result_date DESC
      LIMIT 200
    ) c
  ),
  agg AS (
    SELECT item_number,
           count(*)::int AS n,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY awarded_unit_price)::text AS median,
           percentile_cont(0.25) WITHIN GROUP (ORDER BY awarded_unit_price)::text AS p25,
           percentile_cont(0.75) WITHIN GROUP (ORDER BY awarded_unit_price)::text AS p75
    FROM comp
    GROUP BY item_number
  ),
  recent AS (
    SELECT item_number, supplier_tax_id, supplier_name,
           supplier_size_name, awarded_unit_price, result_date,
           row_number() OVER (
             PARTITION BY item_number ORDER BY result_date DESC NULLS LAST
           ) AS rn
    FROM comp
  ),
  win AS (
    SELECT item_number,
           json_agg(json_build_object(
             'supplier_tax_id', supplier_tax_id,
             'supplier_name', supplier_name,
             'supplier_size_name', supplier_size_name,
             'awarded_unit_price', awarded_unit_price::text,
             'result_date', result_date
           ) ORDER BY result_date DESC NULLS LAST) AS winners
    FROM recent
    WHERE rn <= 20
    GROUP BY item_number
  )
  SELECT target.item_number,
         coalesce(agg.n, 0) AS n,
         agg.median,
         agg.p25,
         agg.p75,
         win.winners,
         EXISTS (
           SELECT 1
           FROM procurement_items hist
           WHERE hist.procurement_id <> $1
             AND ${FTS_MATCH}
             AND ${SAME_UNIT}
             AND hist.results_requested_at IS NOT NULL
             AND hist.results_synced_at IS NULL
         ) AS pending
  FROM target
  LEFT JOIN agg ON agg.item_number = target.item_number
  LEFT JOIN win ON win.item_number = target.item_number
`;

// Same LATERAL match, but selecting historical items that have no result row
// yet. Bounded to 40 per target item — lazy fill, not an open crawl.
const ENQUEUE_SQL = `
  UPDATE procurement_items SET results_requested_at = now()
  WHERE (procurement_id, item_number) IN (
    SELECT c.procurement_id, c.item_number
    FROM (
      SELECT t.item_number, t.tsq, i.unit
      FROM unnest($2::int[], $3::text[]) AS t(item_number, tsq)
      JOIN procurement_items i
        ON i.procurement_id = $1 AND i.item_number = t.item_number
    ) target
    CROSS JOIN LATERAL (
      SELECT hist.procurement_id, hist.item_number
      FROM procurement_items hist
      WHERE hist.procurement_id <> $1
        AND ${FTS_MATCH}
        AND ${SAME_UNIT}
        AND hist.results_synced_at IS NULL
        AND hist.results_requested_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM procurement_results r
          WHERE r.procurement_id = hist.procurement_id
            AND r.item_number = hist.item_number
        )
      LIMIT 40
    ) c
  )
  AND results_requested_at IS NULL
`;

// --- row shapes as pg returns them -----------------------------------------

type TargetRow = { item_number: number; description: string | null };

// result_date arrives as a 'YYYY-MM-DD' string because it is built by
// json_build_object, not decoded as a pg date.
type WinnerRaw = {
  supplier_tax_id: string | null;
  supplier_name: string | null;
  supplier_size_name: string | null;
  awarded_unit_price: string | null;
  result_date: string | Date | null;
};

type BenchmarkRow = {
  item_number: number;
  n: number;
  median: string | null;
  p25: string | null;
  p75: string | null;
  winners: WinnerRaw[] | null;
  pending: boolean;
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

function toWinners(raw: WinnerRaw[] | null): Winner[] {
  if (!raw) return [];
  const sorted = raw
    .map((v) => ({ ...v, result_date: toDate(v.result_date) }))
    .sort((a, b) => (b.result_date?.getTime() ?? 0) - (a.result_date?.getTime() ?? 0));
  const seen = new Set<string>();
  const out: Winner[] = [];
  for (const v of sorted) {
    if (v.supplier_tax_id !== null) {
      if (seen.has(v.supplier_tax_id)) continue;
      seen.add(v.supplier_tax_id);
    }
    out.push({
      supplier_tax_id: v.supplier_tax_id,
      supplier_name: v.supplier_name,
      supplier_size_name: v.supplier_size_name,
      awarded_unit_price: v.awarded_unit_price,
      result_date: v.result_date,
    });
    if (out.length === 3) break;
  }
  return out;
}

function toPriceItem(row: BenchmarkRow): PriceItem {
  const n = Number(row.n);
  const ok = n >= MIN_SAMPLE;
  return {
    item_number: row.item_number,
    // Below the threshold the percentiles stay null on purpose.
    state: ok ? "ok" : row.pending ? "collecting" : "insufficient",
    n,
    median: ok ? row.median : null,
    p25: ok ? row.p25 : null,
    p75: ok ? row.p75 : null,
    winners: toWinners(row.winners),
  };
}

async function fetchTargets(procurementId: number): Promise<TargetRow[]> {
  const result = await pool.query<TargetRow>(
    `SELECT item_number, description
     FROM procurement_items
     WHERE procurement_id = $1
     ORDER BY item_number ASC`,
    [procurementId],
  );
  return result.rows;
}

/**
 * Per item of the procurement, the median awarded unit price of comparable
 * historical items. Two aggregate queries at most, both batched over every item
 * — the precise one, then the broader `fallback` one for the items that came
 * back below the sample threshold. Never one query per item.
 */
export async function fetchPriceBenchmark(
  procurementId: number,
): Promise<Map<number, PriceItem>> {
  const targets = await fetchTargets(procurementId);
  const out = new Map<number, PriceItem>();
  const numbers: number[] = [];
  const primaries: string[] = [];
  const fallbacks = new Map<number, string>();

  for (const target of targets) {
    const { primary, fallback } = buildTsQuery(target.description);
    // No usable token: nothing to compare against, and no query to run.
    out.set(target.item_number, {
      item_number: target.item_number,
      state: "insufficient",
      n: 0,
      median: null,
      p25: null,
      p75: null,
      winners: [],
    });
    if (primary === null) continue;
    numbers.push(target.item_number);
    primaries.push(primary);
    // A fallback identical to the primary would just repeat the same work.
    if (fallback !== null && fallback !== primary) {
      fallbacks.set(target.item_number, fallback);
    }
  }
  if (numbers.length === 0) return out;

  const precise = await pool.query<BenchmarkRow>(BENCHMARK_SQL, [
    procurementId,
    numbers,
    primaries,
  ]);
  for (const row of precise.rows) out.set(row.item_number, toPriceItem(row));

  const below = precise.rows
    .filter((row) => Number(row.n) < MIN_SAMPLE && fallbacks.has(row.item_number))
    .map((row) => row.item_number);
  if (below.length === 0) return out;

  const broad = await pool.query<BenchmarkRow>(BENCHMARK_SQL, [
    procurementId,
    below,
    below.map((itemNumber) => fallbacks.get(itemNumber) as string),
  ]);
  for (const row of broad.rows) {
    const item = toPriceItem(row);
    const previous = out.get(row.item_number);
    // The broader query can only widen the sample, but both are capped at 200
    // per target item — keep whichever actually found more.
    if (!previous || item.n >= previous.n) out.set(row.item_number, item);
  }
  return out;
}

/**
 * Queues the comparable historical items that have no result yet, so
 * `lixto sync results` can fill them in. Safe to call on every page view:
 * already-queued and already-collected items are excluded by the WHERE clause,
 * so repeated calls converge to zero. Returns the number of items queued.
 */
export async function enqueueMissingResults(
  procurementId: number,
): Promise<number> {
  const targets = await fetchTargets(procurementId);
  const numbers: number[] = [];
  const queries: string[] = [];
  for (const target of targets) {
    const { primary } = buildTsQuery(target.description);
    if (primary === null) continue;
    numbers.push(target.item_number);
    queries.push(primary);
  }
  if (numbers.length === 0) return 0;

  const result = await pool.query(ENQUEUE_SQL, [
    procurementId,
    numbers,
    queries,
  ]);
  return result.rowCount ?? 0;
}
