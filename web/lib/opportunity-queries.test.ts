import { beforeEach, describe, expect, it, vi } from "vitest";

// Relative imports (not "@/lib/...") on purpose: vitest runs without a config
// file. The pool is mocked — these tests never touch a live database.
vi.mock("./db", () => ({ pool: { query: vi.fn() } }));

import { pool } from "./db";
import {
  ATTENTION_SCORE,
  MATCH_SCORE,
  getLastRun,
  getOpportunity,
  insertFeedback,
  insertMatch,
  listOpportunities,
  setOpportunityState,
  upsertOpportunity,
} from "./opportunity-queries";

const query = pool.query as unknown as ReturnType<typeof vi.fn>;

function dbRow(over: Record<string, unknown> = {}) {
  return {
    id: "10",
    company_id: "1",
    procurement_id: "77",
    source_id: "12345678000199-1-000001/2026",
    state: "matched",
    score: 55,
    reasons: [{ code: "term_enrichment", weight: 25, detail: "lapis" }],
    attention: false,
    computed_at: new Date("2026-08-20T10:00:00Z"),
    description: "Aquisição de lápis",
    agency_name: "Prefeitura",
    state_uf: "RJ",
    city_name: "Rio de Janeiro",
    modality_name: "Pregão",
    estimated_value: "1000.00",
    proposal_closes_at: new Date("2026-09-30T12:00:00Z"),
    verdict: null,
    rationale: null,
    ...over,
  };
}

beforeEach(() => {
  query.mockReset();
  query.mockResolvedValue({ rows: [] });
});

describe("thresholds", () => {
  it("are the product numbers", () => {
    expect(ATTENTION_SCORE).toBe(70);
    expect(MATCH_SCORE).toBe(40);
  });
});

describe("insertMatch", () => {
  it("binds companyId and serializes reasons as JSONB", async () => {
    const reasons = [{ code: "cnae_primary" as const, weight: 35, detail: "4761003" }];
    await insertMatch(7, 99, 80, reasons, "1");

    const [text, values] = query.mock.calls[0];
    expect(text).toContain("INSERT INTO matches");
    expect(text).toContain("$4::jsonb");
    expect(values).toEqual([7, 99, 80, JSON.stringify(reasons), "1"]);
    expect(text).not.toContain("cnae_primary");
  });
});

describe("upsertOpportunity", () => {
  it("never regresses the state and reports whether it inserted", async () => {
    query.mockResolvedValueOnce({ rows: [{ id: "5", created: true }] });
    await expect(upsertOpportunity(1, 2)).resolves.toEqual({
      id: 5,
      created: true,
    });

    const [text, values] = query.mock.calls[0];
    expect(text).toContain("ON CONFLICT (company_id, procurement_id)");
    expect(text).toContain("DO UPDATE SET updated_at = now()");
    expect(text).not.toContain("SET state");
    expect(text).toContain("(xmax = 0) AS created");
    expect(values).toEqual([1, 2]);
  });

  it("reports created=false for an existing pair", async () => {
    query.mockResolvedValueOnce({ rows: [{ id: "5", created: false }] });
    await expect(upsertOpportunity(1, 2)).resolves.toEqual({
      id: 5,
      created: false,
    });
  });
});

describe("listOpportunities", () => {
  it("takes the latest match per pair with DISTINCT ON, scoped to the company", async () => {
    await listOpportunities(1);

    const [text, values] = query.mock.calls[0];
    expect(text).toContain("DISTINCT ON (company_id, procurement_id)");
    expect(text).toContain("ORDER BY company_id, procurement_id, computed_at DESC");
    expect(text).toContain("FROM matches\n     WHERE company_id = $1");
    expect(text).toContain("WHERE o.company_id = $1");
    expect(text).toContain("LEFT JOIN LATERAL");
    expect(text).toContain("FROM recommendations rec");
    expect(text).toContain(
      "ORDER BY coalesce(m.score, 0) DESC, p.proposal_closes_at ASC NULLS LAST",
    );
    expect(values[0]).toBe(1);
  });

  it("computes attention in SQL from the attention threshold", async () => {
    await listOpportunities(1);
    const [text] = query.mock.calls[0];
    expect(text).toContain(
      `(coalesce(m.score, 0) >= ${ATTENTION_SCORE}) AS attention`,
    );
  });

  it("binds every optional filter", async () => {
    const since = new Date("2026-08-25T00:00:00Z");
    await listOpportunities(3, {
      states: ["matched", "recommended"],
      minScore: 70,
      limit: 5,
      sinceRunAt: since,
    });

    const [text, values] = query.mock.calls[0];
    expect(text).toContain("o.state = ANY($");
    expect(text).toContain("coalesce(m.score, 0) >= $");
    expect(text).toContain("coalesce(m.computed_at, o.created_at) >= $");
    expect(values).toEqual([3, ["matched", "recommended"], 70, since, 5]);
    expect(text).not.toContain("'matched'");
  });

  it("maps bigint strings to numbers and keeps the attention flag", async () => {
    query.mockResolvedValueOnce({
      rows: [dbRow(), dbRow({ id: "11", score: 90, attention: true })],
    });

    const rows = await listOpportunities(1);

    expect(rows[0].id).toBe(10);
    expect(rows[0].company_id).toBe(1);
    expect(rows[0].procurement_id).toBe(77);
    expect(rows[0].score).toBe(55);
    expect(rows[0].attention).toBe(false);
    expect(rows[0].reasons[0].code).toBe("term_enrichment");
    expect(rows[1].attention).toBe(true);
  });

  it("defaults to a bound limit", async () => {
    await listOpportunities(1);
    const [text, values] = query.mock.calls[0];
    expect(text).toContain(`LIMIT $${values.length}`);
    expect(values[values.length - 1]).toBe(50);
  });
});

describe("getOpportunity", () => {
  it("binds both the company and the source id", async () => {
    query.mockResolvedValueOnce({ rows: [dbRow()] });
    const row = await getOpportunity(1, "abc/2026");

    const [text, values] = query.mock.calls[0];
    expect(text).toContain("WHERE o.company_id = $1 AND p.source_id = $2");
    expect(values).toEqual([1, "abc/2026"]);
    expect(row?.id).toBe(10);
  });

  it("is null when nothing belongs to the company", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    expect(await getOpportunity(1, "abc/2026")).toBe(null);
  });
});

describe("setOpportunityState", () => {
  it("binds both ids", async () => {
    await setOpportunityState(4, 9, "dismissed");
    const [text, values] = query.mock.calls[0];
    expect(text).toContain("WHERE id = $2 AND company_id = $1");
    expect(values).toEqual([4, 9, "dismissed"]);
  });
});

describe("insertFeedback", () => {
  it("verifies ownership inside the insert", async () => {
    await insertFeedback(4, 9, 2, "rejected", "fora do escopo");
    const [text, values] = query.mock.calls[0];
    expect(text).toContain("INSERT INTO opportunity_feedback");
    expect(text).toContain("FROM opportunities o");
    expect(text).toContain("WHERE o.id = $2 AND o.company_id = $1");
    expect(values).toEqual([4, 9, 2, "rejected", "fora do escopo"]);
  });
});

describe("getLastRun", () => {
  it("looks at the global run when no company is given", async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          id: "3",
          started_at: new Date("2026-08-24T03:00:00Z"),
          finished_at: new Date("2026-08-24T03:01:00Z"),
          counters: { scored: 12 },
          status: "done",
        },
      ],
    });

    const run = await getLastRun("match");

    const [text, values] = query.mock.calls[0];
    expect(text).toContain("company_id IS NULL");
    expect(values).toEqual(["match"]);
    expect(run?.id).toBe(3);
    expect(run?.counters.scored).toBe(12);
  });

  it("binds the company when one is given", async () => {
    await getLastRun("recommend", 8);
    const [text, values] = query.mock.calls[0];
    expect(text).toContain("company_id = $2");
    expect(values).toEqual(["recommend", 8]);
  });

  it("is null when the kind never ran", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    expect(await getLastRun("match")).toBe(null);
  });
});
