import { beforeEach, describe, expect, it, vi } from "vitest";

// Relative imports (not "@/lib/...") on purpose: vitest.config.ts defines no
// resolve alias. Only the pool is mocked — the scoring is the real radar-engine, so the
// numbers bound into the upsert are the numbers production writes.
vi.mock("./db", () => ({ pool: { query: vi.fn() } }));

import { pool } from "./db";
import { horizonDays, runRadarBatch } from "./radar-batch";

const query = pool.query as unknown as ReturnType<typeof vi.fn>;

const HORIZON = "ORDER BY p.id, i.item_number";
const UPSERT = "INSERT INTO future_opportunities";
const EXPIRE = "SET status = 'expired'";
const LIST_COMPANIES = "SELECT company_id FROM company_profiles ORDER BY company_id";
const GET_PROFILE = "products, keywords, exclusions, terms";
const SIZE = "SELECT size FROM companies WHERE id = $1";
const EMBEDDING_TEXT = "embedding::text AS embedding";
const CANDIDATES = "ORDER BY fo.id";
const MATCH_UPSERT = "INSERT INTO future_opportunity_matches";
const MATCH_PRUNE = "DELETE FROM future_opportunity_matches";

type Row = {
  plan_id: string;
  item_number: number;
  agency_tax_id: string;
  state: string | null;
  title: string;
  pdm_code: string | null;
  category_name: string | null;
  estimated_value: string | null;
  expected_date: string | null;
  plan_year: number;
  plan_updated_at: string | null;
};

function row(plan_id: number, item_number: number, over: Partial<Row> = {}): Row {
  return {
    plan_id: String(plan_id),
    item_number,
    agency_tax_id: "12345678000199",
    state: "RJ",
    title: "Aquisição de lápis preto nº 2",
    pdm_code: "PDM-1",
    category_name: "Material de expediente",
    estimated_value: "1234.56",
    expected_date: "2026-10-01",
    plan_year: 2026,
    plan_updated_at: "2026-09-01T00:00:00.000Z",
    ...over,
  };
}

/** The pool answers the run open/close by SQL text, hands out `pages` of
 * horizon rows in order, and — for the ticket 126 company-match pass — every
 * company in `companyIds` gets an empty profile (no row), no size, no
 * embedding and no candidates, so the default here is "nothing to match, run
 * still succeeds". Tests that want to exercise real matching mock
 * `query.mockImplementation` directly instead of using this helper. */
function mockPool(pages: Row[][], expired = 0, companyIds: number[] = []) {
  let page = 0;
  query.mockImplementation(async (text: string) => {
    if (text.includes("INSERT INTO agent_runs")) return { rows: [{ id: "42" }] };
    if (text.includes("UPDATE agent_runs")) return { rows: [] };
    if (text.includes(HORIZON)) return { rows: pages[page++] ?? [] };
    if (text.includes(UPSERT)) return { rows: [] };
    if (text.includes(EXPIRE)) return { rows: [], rowCount: expired };
    if (text.includes(LIST_COMPANIES)) {
      return { rows: companyIds.map((id) => ({ company_id: String(id) })) };
    }
    if (text.includes(EMBEDDING_TEXT)) return { rows: [{ embedding: null }] };
    if (text.includes(SIZE)) return { rows: [] };
    if (text.includes(GET_PROFILE)) return { rows: [] };
    if (text.includes(CANDIDATES)) return { rows: [] };
    if (text.includes(MATCH_UPSERT)) return { rows: [] };
    if (text.includes(MATCH_PRUNE)) return { rows: [], rowCount: 0 };
    throw new Error(`unexpected query: ${text}`);
  });
}

/** All pool calls whose SQL contains `fragment`, as [text, values]. */
function callsWith(fragment: string): [string, unknown[]][] {
  return query.mock.calls
    .filter((c) => String(c[0]).includes(fragment))
    .map((c) => [String(c[0]), (c[1] ?? []) as unknown[]]);
}

function callWith(fragment: string): [string, unknown[]] {
  const found = callsWith(fragment);
  if (found.length === 0) throw new Error(`no query containing ${fragment}`);
  return found[0];
}

beforeEach(() => {
  query.mockReset();
});

describe("horizonDays", () => {
  it("defaults to 365 and rejects junk", () => {
    expect(horizonDays({})).toBe(365);
    expect(horizonDays({ LIXTO_RADAR_HORIZON_DAYS: "" })).toBe(365);
    expect(horizonDays({ LIXTO_RADAR_HORIZON_DAYS: "abc" })).toBe(365);
    expect(horizonDays({ LIXTO_RADAR_HORIZON_DAYS: "0" })).toBe(365);
    expect(horizonDays({ LIXTO_RADAR_HORIZON_DAYS: "-5" })).toBe(365);
  });

  it("reads a positive override", () => {
    expect(horizonDays({ LIXTO_RADAR_HORIZON_DAYS: "90" })).toBe(90);
    expect(horizonDays({ LIXTO_RADAR_HORIZON_DAYS: "90.7" })).toBe(90);
  });
});

describe("runRadarBatch", () => {
  it("returns the counters and writes nothing when the horizon is empty", async () => {
    mockPool([[]]);

    const out = await runRadarBatch();

    expect(out).toEqual({
      runId: 42,
      opportunities: 0,
      expired: 0,
      companies: 0,
      matched: 0,
    });
    expect(callsWith(UPSERT)).toHaveLength(0);
    expect(callsWith(EXPIRE)).toHaveLength(1);
  });

  it("stops after a short page (no extra horizon query)", async () => {
    mockPool([[row(1, 1), row(1, 2)]]);

    const out = await runRadarBatch();

    expect(callsWith(HORIZON)).toHaveLength(1);
    expect(out.opportunities).toBe(2);
  });

  it("keyset-pages until a page is short and terminates", async () => {
    const full = Array.from({ length: 500 }, (_, i) => row(1, i + 1));
    mockPool([full, [row(2, 7)]]);

    const out = await runRadarBatch();

    const horizon = callsWith(HORIZON);
    expect(horizon).toHaveLength(2);
    // first page starts before every real key, second resumes at (1, 500)
    expect(horizon[0][1].slice(1)).toEqual(["0", -1]);
    expect(horizon[1][1].slice(1)).toEqual(["1", 500]);
    expect(out.opportunities).toBe(501);
  });

  it("stops on an empty page after a full one", async () => {
    const full = Array.from({ length: 500 }, (_, i) => row(3, i + 1));
    mockPool([full, []]);

    const out = await runRadarBatch();

    expect(callsWith(HORIZON)).toHaveLength(2);
    expect(callsWith(UPSERT)).toHaveLength(1);
    expect(out.opportunities).toBe(500);
  });

  it("binds the horizon days as the first parameter", async () => {
    mockPool([[]]);

    await runRadarBatch();

    expect(callWith(HORIZON)[1][0]).toBe(365);
  });

  it("binds the snapshot columns and the engine output per row", async () => {
    mockPool([[row(9, 4, { expected_date: null, plan_updated_at: null })]]);

    await runRadarBatch();

    const [text, values] = callWith(UPSERT);
    expect(values).toEqual([
      "9",
      4,
      "12345678000199",
      "RJ",
      "Aquisição de lápis preto nº 2",
      "PDM-1",
      "Material de expediente",
      "1234.56",
      null,
      2026,
      50, // pca_item only: no date, stale plan
      JSON.stringify([
        {
          code: "pca_item",
          weight: 50,
          detail: "Item previsto no Plano de Contratações Anual (PCA) do órgão",
        },
        {
          code: "date_far",
          weight: 0,
          detail:
            "Sem data desejada informada no PCA; período de compra ainda indefinido",
        },
      ]),
      "1",
    ]);
    expect(text).toContain("ON CONFLICT (plan_id, item_number) DO UPDATE");
  });

  it("upserts a whole page in one statement", async () => {
    mockPool([[row(1, 1), row(1, 2), row(1, 3)]]);

    await runRadarBatch();

    const upserts = callsWith(UPSERT);
    expect(upserts).toHaveLength(1);
    expect(upserts[0][1]).toHaveLength(3 * 13);
    expect(upserts[0][0]).toContain("$27");
    expect(upserts[0][0]).toContain("$39");
  });

  it("revives expired rows but never touches procurement_found", async () => {
    mockPool([[row(1, 1)]]);

    await runRadarBatch();

    const [text] = callWith(UPSERT);
    expect(text).toContain(
      "CASE WHEN future_opportunities.status = 'expired'",
    );
    expect(text).toContain("THEN 'predicted'");
    expect(text).toContain("ELSE future_opportunities.status END");
    // detected_at is evidence, never rewritten
    expect(text).not.toContain("detected_at =");
  });

  it("expires past-date and orphaned rows, qualified by the outer alias", async () => {
    mockPool([[]], 7);

    const out = await runRadarBatch();

    const [text] = callWith(EXPIRE);
    expect(text).toContain("f.status = 'predicted'");
    expect(text).toContain("f.expected_date < current_date");
    expect(text).toContain("i.plan_id = f.plan_id");
    expect(text).toContain("i.item_number = f.item_number");
    expect(out.expired).toBe(7);
  });

  it("opens the run as radar/running and closes it done with counters", async () => {
    mockPool([[row(1, 1), row(1, 2)]], 3);

    await runRadarBatch();

    const [openText, openValues] = callWith("INSERT INTO agent_runs");
    expect(openText).toContain("'radar'");
    expect(openText).toContain("'running'");
    expect(openValues).toEqual([null]);

    const [, close] = callWith("UPDATE agent_runs");
    expect(close[0]).toBe(42);
    expect(close[1]).toBe("done");
    expect(JSON.parse(String(close[2]))).toEqual({
      items: 2,
      opportunities: 2,
      expired: 3,
      pages: 1,
      companies: 0,
      matched: 0,
      failed: 0,
    });
    expect(close[3]).toBeNull();
  });

  it("stamps a scoped run with the company id and scores just that company", async () => {
    mockPool([[row(1, 1)]]);

    const out = await runRadarBatch({ companyId: 5 });

    expect(callWith("INSERT INTO agent_runs")[1]).toEqual([5]);
    // companyId given: no global listCompaniesWithProfile query...
    expect(callsWith(LIST_COMPANIES)).toHaveLength(0);
    // ...but the one company is still scored (profile load + candidates + prune).
    expect(callWith(GET_PROFILE)[1]).toEqual([5]);
    expect(callsWith(CANDIDATES)).toHaveLength(1);
    expect(callsWith(MATCH_PRUNE)).toHaveLength(1);
    expect(out.companies).toBe(1);
    expect(out.matched).toBe(0);
  });

  it("marks the run failed and rethrows on an unexpected error", async () => {
    query.mockImplementation(async (text: string) => {
      if (text.includes("INSERT INTO agent_runs")) return { rows: [{ id: "42" }] };
      if (text.includes("UPDATE agent_runs")) return { rows: [] };
      throw new Error("db is down");
    });

    await expect(runRadarBatch()).rejects.toThrow("db is down");

    const [, close] = callWith("UPDATE agent_runs");
    expect(close[1]).toBe("failed");
    expect(close[3]).toBe("db is down");
  });
});

describe("runRadarBatch company match pass", () => {
  const PROFILE_ROW = {
    company_id: 1,
    products: ["lápis"],
    keywords: [],
    exclusions: [],
    terms: ["lapis"],
    exclusion_terms: [],
    states: [],
    min_value: null,
    max_value: null,
    notes: null,
    embedding_text: null,
  };

  function mockRun({
    companyIds,
    profiles,
    candidatesByCompany,
    pruneRowCount = 0,
    failCompanyId,
  }: {
    companyIds: number[];
    profiles: Record<number, Record<string, unknown> | null>;
    candidatesByCompany: Record<number, Record<string, unknown>[]>;
    pruneRowCount?: number;
    failCompanyId?: number;
  }) {
    query.mockImplementation(async (text: string, values?: unknown[]) => {
      if (text.includes("INSERT INTO agent_runs")) return { rows: [{ id: "42" }] };
      if (text.includes("UPDATE agent_runs")) return { rows: [] };
      if (text.includes(HORIZON)) return { rows: [] };
      if (text.includes(EXPIRE)) return { rows: [], rowCount: 0 };
      if (text.includes(LIST_COMPANIES)) {
        return { rows: companyIds.map((id) => ({ company_id: String(id) })) };
      }
      if (text.includes(GET_PROFILE)) {
        const companyId = Number((values as unknown[])[0]);
        const row = profiles[companyId];
        return { rows: row ? [row] : [] };
      }
      if (text.includes(SIZE)) return { rows: [{ size: "ME" }] };
      if (text.includes(EMBEDDING_TEXT)) return { rows: [{ embedding: null }] };
      if (text.includes(CANDIDATES)) {
        const companyId = Number((values as unknown[])[0]);
        if (companyId === failCompanyId) throw new Error(`boom-${companyId}`);
        return { rows: candidatesByCompany[companyId] ?? [] };
      }
      if (text.includes(MATCH_UPSERT)) return { rows: [] };
      if (text.includes(MATCH_PRUNE)) return { rows: [], rowCount: pruneRowCount };
      throw new Error(`unexpected query: ${text}`);
    });
  }

  it("scores every company with a profile and persists rows >= RADAR_MATCH_MIN", async () => {
    mockRun({
      companyIds: [1],
      profiles: { 1: PROFILE_ROW },
      candidatesByCompany: {
        1: [
          {
            id: "100",
            state: null,
            estimated_value: null,
            text_hit: true,
            exclusion_hit: false,
            similarity: null,
          },
        ],
      },
    });

    const out = await runRadarBatch();

    expect(out.companies).toBe(1);
    expect(out.matched).toBe(1); // term_text alone = 40 = RADAR_MATCH_MIN

    const [, upsertValues] = callWith(MATCH_UPSERT);
    expect(upsertValues[0]).toBe(1);
    expect(upsertValues).toContain(100);
    expect(upsertValues).toContain(40);

    const [, pruneValues] = callWith(MATCH_PRUNE);
    expect(pruneValues).toEqual([1, [100]]);
  });

  it("does not upsert or count candidates scoring below RADAR_MATCH_MIN", async () => {
    mockRun({
      companyIds: [1],
      profiles: { 1: PROFILE_ROW },
      candidatesByCompany: {
        1: [
          {
            id: "200",
            state: null,
            estimated_value: null,
            text_hit: false,
            exclusion_hit: false,
            similarity: 0.1, // below the weakest band: no reason at all
          },
        ],
      },
    });

    const out = await runRadarBatch();

    expect(out.matched).toBe(0);
    expect(callsWith(MATCH_UPSERT)).toHaveLength(0);
    const [, pruneValues] = callWith(MATCH_PRUNE);
    expect(pruneValues).toEqual([1, []]);
  });

  it("runs the match pass after expiry", async () => {
    mockRun({
      companyIds: [1],
      profiles: { 1: PROFILE_ROW },
      candidatesByCompany: { 1: [] },
    });

    await runRadarBatch();

    const expireIndex = query.mock.calls.findIndex((c) =>
      String(c[0]).includes(EXPIRE),
    );
    const listCompaniesIndex = query.mock.calls.findIndex((c) =>
      String(c[0]).includes(LIST_COMPANIES),
    );
    expect(expireIndex).toBeGreaterThanOrEqual(0);
    expect(listCompaniesIndex).toBeGreaterThan(expireIndex);
  });

  it("counts a failing company without failing the run, and records the first error", async () => {
    mockRun({
      companyIds: [1, 2],
      profiles: { 1: PROFILE_ROW, 2: PROFILE_ROW },
      candidatesByCompany: {
        2: [
          {
            id: "300",
            state: null,
            estimated_value: null,
            text_hit: true,
            exclusion_hit: false,
            similarity: null,
          },
        ],
      },
      failCompanyId: 1,
    });

    const out = await runRadarBatch();

    expect(out.companies).toBe(2);
    expect(out.matched).toBe(1); // only company 2 scored

    const [, close] = callWith("UPDATE agent_runs");
    expect(close[1]).toBe("done"); // one bad company never fails the whole run
    expect(JSON.parse(String(close[2])).failed).toBe(1);
    expect(close[3]).toBe("boom-1");
  });
});
