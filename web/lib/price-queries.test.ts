import { beforeEach, describe, expect, it, vi } from "vitest";

// Relative imports (not "@/lib/...") on purpose: vitest runs without a config
// file. The pool is mocked — these tests never touch a live database.
vi.mock("./db", () => ({ pool: { query: vi.fn() } }));

import { pool } from "./db";
import {
  buildTsQuery,
  enqueueMissingResults,
  fetchPriceBenchmark,
} from "./price-queries";

const query = pool.query as unknown as ReturnType<typeof vi.fn>;

const PROCUREMENT_ID = 4711;

type QueryResult = { rows: unknown[]; rowCount?: number };

function result(rows: unknown[], rowCount?: number): QueryResult {
  return { rows, rowCount: rowCount ?? rows.length };
}

/** The first query of both exported functions: the procurement's own items. */
function items(...rows: { item_number: number; description: string | null }[]) {
  return result(rows);
}

function benchRow(over: Record<string, unknown> = {}) {
  return {
    item_number: 1,
    n: 0,
    median: null,
    p25: null,
    p75: null,
    winners: null,
    pending: false,
    ...over,
  };
}

beforeEach(() => {
  query.mockReset();
});

describe("buildTsQuery", () => {
  it("returns nulls for null/empty description", () => {
    expect(buildTsQuery(null)).toEqual({ primary: null, fallback: null });
    expect(buildTsQuery("")).toEqual({ primary: null, fallback: null });
    expect(buildTsQuery("   ")).toEqual({ primary: null, fallback: null });
  });

  it("strips accents and lowercases", () => {
    expect(buildTsQuery("Lápis Preto Nº2 GRÁFITE").primary).toBe(
      "lapis & preto & grafite",
    );
  });

  it("drops tokens shorter than 4 characters", () => {
    expect(buildTsQuery("papel A4 de gramatura").primary).toBe(
      "papel & gramatura",
    );
  });

  it("drops stop words, including accented ones after stripping", () => {
    expect(
      buildTsQuery("Material de limpeza tipo detergente conforme referência")
        .primary,
    ).toBe("limpeza & detergente");
    expect(buildTsQuery("Serviço de manutenção predial").primary).toBe(
      "manutencao & predial",
    );
  });

  it("caps primary at 6 tokens and fallback at 3", () => {
    const description =
      "cadeira giratoria ergonomica encosto telado braco regulavel rodizio";
    expect(buildTsQuery(description)).toEqual({
      primary: "cadeira & giratoria & ergonomica & encosto & telado & braco",
      fallback: "cadeira & giratoria & ergonomica",
    });
  });

  it("uses whatever survives when there are fewer than 3 tokens", () => {
    expect(buildTsQuery("papel sulfite")).toEqual({
      primary: "papel & sulfite",
      fallback: "papel & sulfite",
    });
  });

  it("returns nulls when every token is dropped", () => {
    expect(buildTsQuery("de um p/ 12 - item")).toEqual({
      primary: null,
      fallback: null,
    });
  });
});

describe("fetchPriceBenchmark", () => {
  it("marks n >= 5 as ok and keeps the percentiles", async () => {
    query
      .mockResolvedValueOnce(items({ item_number: 1, description: "papel sulfite branco" }))
      .mockResolvedValueOnce(
        result([benchRow({ n: 7, median: "19.90", p25: "18.00", p75: "22.50" })]),
      );

    const map = await fetchPriceBenchmark(PROCUREMENT_ID);

    expect(query).toHaveBeenCalledTimes(2);
    expect(map.get(1)).toMatchObject({
      item_number: 1,
      state: "ok",
      n: 7,
      median: "19.90",
      p25: "18.00",
      p75: "22.50",
    });
  });

  it("binds the procurement id as $1 and never interpolates it", async () => {
    query
      .mockResolvedValueOnce(items({ item_number: 1, description: "papel sulfite branco" }))
      .mockResolvedValueOnce(result([benchRow({ n: 9 })]));

    await fetchPriceBenchmark(PROCUREMENT_ID);

    const [text, values] = query.mock.calls[1];
    expect(text).toContain("hist.procurement_id <> $1");
    expect(text).not.toContain(String(PROCUREMENT_ID));
    expect(values[0]).toBe(PROCUREMENT_ID);
    expect(values[1]).toEqual([1]);
    expect(values[2]).toEqual(["papel & sulfite & branco"]);
  });

  it("uses the GIN-indexed FTS expression, the bounded LATERAL and the winner-only rule", async () => {
    query
      .mockResolvedValueOnce(items({ item_number: 1, description: "papel sulfite branco" }))
      .mockResolvedValueOnce(result([benchRow({ n: 9 })]));

    await fetchPriceBenchmark(PROCUREMENT_ID);

    const [text] = query.mock.calls[1];
    expect(text).toContain(
      "to_tsvector('portuguese', f_unaccent(coalesce(hist.description, '')))",
    );
    expect(text).toContain("to_tsquery('portuguese', target.tsq)");
    expect(text).toContain("LIMIT 200");
    expect(text).toContain(
      "(r.price_registry_rank IS NULL OR r.price_registry_rank = 1)",
    );
    expect(text).toContain("r.result_date >= current_date - interval '24 months'");
  });

  it("reports collecting with null percentiles when n < 5 and items are queued", async () => {
    query
      .mockResolvedValueOnce(items({ item_number: 1, description: "papel sulfite branco" }))
      .mockResolvedValueOnce(
        result([
          benchRow({ n: 2, median: "19.90", p25: "18.00", p75: "22.50", pending: true }),
        ]),
      );

    const map = await fetchPriceBenchmark(PROCUREMENT_ID);

    expect(map.get(1)).toMatchObject({
      state: "collecting",
      n: 2,
      median: null,
      p25: null,
      p75: null,
    });
  });

  it("reports insufficient when n < 5 and nothing is pending", async () => {
    query
      .mockResolvedValueOnce(items({ item_number: 1, description: "papel sulfite branco" }))
      .mockResolvedValueOnce(
        result([benchRow({ n: 2, median: "19.90", pending: false })]),
      );

    const map = await fetchPriceBenchmark(PROCUREMENT_ID);

    expect(map.get(1)).toMatchObject({ state: "insufficient", n: 2, median: null });
  });

  it("fires the fallback query only for the items below the threshold", async () => {
    query
      .mockResolvedValueOnce(
        items(
          { item_number: 1, description: "cadeira giratoria ergonomica encosto telado" },
          { item_number: 2, description: "mesa escritorio retangular tampo melaminico" },
        ),
      )
      .mockResolvedValueOnce(
        result([
          benchRow({ item_number: 1, n: 8, median: "500.00" }),
          benchRow({ item_number: 2, n: 1 }),
        ]),
      )
      .mockResolvedValueOnce(
        result([benchRow({ item_number: 2, n: 6, median: "300.00" })]),
      );

    const map = await fetchPriceBenchmark(PROCUREMENT_ID);

    expect(query).toHaveBeenCalledTimes(3);
    const [, values] = query.mock.calls[2];
    expect(values[1]).toEqual([2]);
    expect(values[2]).toEqual(["mesa & escritorio & retangular"]);
    expect(map.get(1)).toMatchObject({ state: "ok", n: 8, median: "500.00" });
    expect(map.get(2)).toMatchObject({ state: "ok", n: 6, median: "300.00" });
  });

  it("skips both queries for items with no usable token", async () => {
    query.mockResolvedValueOnce(items({ item_number: 1, description: "item de um" }));

    const map = await fetchPriceBenchmark(PROCUREMENT_ID);

    expect(query).toHaveBeenCalledTimes(1);
    expect(map.get(1)).toEqual({
      item_number: 1,
      state: "insufficient",
      n: 0,
      median: null,
      p25: null,
      p75: null,
      winners: [],
    });
  });

  it("deduplicates winners by supplier, caps at 3 and sorts most recent first", async () => {
    query
      .mockResolvedValueOnce(items({ item_number: 1, description: "papel sulfite branco" }))
      .mockResolvedValueOnce(
        result([
          benchRow({
            n: 9,
            median: "19.90",
            winners: [
              { supplier_tax_id: "A", supplier_name: "Alfa", supplier_size_name: "ME", awarded_unit_price: "19.00", result_date: "2026-05-01" },
              { supplier_tax_id: "A", supplier_name: "Alfa", supplier_size_name: "ME", awarded_unit_price: "18.00", result_date: "2026-06-01" },
              { supplier_tax_id: "B", supplier_name: "Beta", supplier_size_name: "EPP", awarded_unit_price: "20.00", result_date: "2026-04-01" },
              { supplier_tax_id: "C", supplier_name: "Gama", supplier_size_name: null, awarded_unit_price: "21.00", result_date: "2026-03-01" },
              { supplier_tax_id: "D", supplier_name: "Delta", supplier_size_name: null, awarded_unit_price: "22.00", result_date: "2026-02-01" },
            ],
          }),
        ]),
      );

    const winners = (await fetchPriceBenchmark(PROCUREMENT_ID)).get(1)!.winners;

    expect(winners).toHaveLength(3);
    expect(winners.map((w) => w.supplier_tax_id)).toEqual(["A", "B", "C"]);
    // Most recent row wins for the deduplicated supplier.
    expect(winners[0].awarded_unit_price).toBe("18.00");
    expect(winners[0].result_date).toBeInstanceOf(Date);
    expect(winners[0].result_date?.getFullYear()).toBe(2026);
  });

  it("returns an empty winners array when there are none", async () => {
    query
      .mockResolvedValueOnce(items({ item_number: 1, description: "papel sulfite branco" }))
      .mockResolvedValueOnce(result([benchRow({ n: 0, pending: true })]));

    const map = await fetchPriceBenchmark(PROCUREMENT_ID);

    expect(map.get(1)).toMatchObject({ state: "collecting", n: 0, winners: [] });
  });
});

describe("enqueueMissingResults", () => {
  it("returns rowCount and binds the procurement id as $1", async () => {
    query
      .mockResolvedValueOnce(items({ item_number: 1, description: "papel sulfite branco" }))
      .mockResolvedValueOnce({ rows: [], rowCount: 12 });

    expect(await enqueueMissingResults(PROCUREMENT_ID)).toBe(12);

    const [text, values] = query.mock.calls[1];
    expect(text).toContain(
      "UPDATE procurement_items SET results_requested_at = now()",
    );
    expect(text).toContain("hist.procurement_id <> $1");
    expect(text).not.toContain(String(PROCUREMENT_ID));
    expect(values[0]).toBe(PROCUREMENT_ID);
    expect(values[1]).toEqual([1]);
    expect(values[2]).toEqual(["papel & sulfite & branco"]);
  });

  it("excludes already-queued and already-collected items, so a second call converges to zero", async () => {
    query
      .mockResolvedValueOnce(items({ item_number: 1, description: "papel sulfite branco" }))
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    expect(await enqueueMissingResults(PROCUREMENT_ID)).toBe(0);

    const [text] = query.mock.calls[1];
    expect(text).toContain("hist.results_requested_at IS NULL");
    expect(text).toContain("hist.results_synced_at IS NULL");
    expect(text).toContain("AND results_requested_at IS NULL");
    expect(text).toContain("LIMIT 40");
  });

  it("does not run the update when no item has a usable token", async () => {
    query.mockResolvedValueOnce(items({ item_number: 1, description: null }));

    expect(await enqueueMissingResults(PROCUREMENT_ID)).toBe(0);
    expect(query).toHaveBeenCalledTimes(1);
  });
});
