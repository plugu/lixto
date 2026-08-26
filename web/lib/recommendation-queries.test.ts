import { beforeEach, describe, expect, it, vi } from "vitest";

// Relative imports (not "@/lib/...") on purpose: vitest runs without a config
// file. The pool is mocked — these tests never touch a live database.
vi.mock("./db", () => ({ pool: { query: vi.fn() } }));

import { pool } from "./db";
import { ATTENTION_SCORE } from "./opportunity-queries";
import {
  countRecommendationsToday,
  insertRecommendation,
  listCandidatesForRecommendation,
  listCompaniesWithCandidates,
} from "./recommendation-queries";

const query = pool.query as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  query.mockResolvedValue({ rows: [] });
});

/** [sql, values] of the single pool call. */
function call(): [string, unknown[]] {
  const [text, values] = query.mock.calls[0] as [string, unknown[]];
  return [text, values];
}

describe("insertRecommendation", () => {
  it("writes verdict, rationale, model and confidence", async () => {
    await insertRecommendation(10, {
      verdict: "go",
      rationale: "Empresa tem atestado de capacidade técnica.",
      model: "gpt-5.1",
      confidence: 0.8,
    });

    const [text, values] = call();
    expect(text).toContain("INSERT INTO recommendations");
    expect(values).toEqual([
      10,
      "go",
      "Empresa tem atestado de capacidade técnica.",
      "gpt-5.1",
      0.8,
    ]);
  });
});

describe("countRecommendationsToday", () => {
  it("counts today's rows for the company only", async () => {
    query.mockResolvedValue({ rows: [{ count: "4" }] });

    await expect(countRecommendationsToday(7)).resolves.toBe(4);

    const [text, values] = call();
    expect(text).toContain("JOIN opportunities o ON o.id = r.opportunity_id");
    expect(text).toContain("o.company_id = $1");
    expect(text).toContain("r.created_at >= date_trunc('day', now())");
    expect(values).toEqual([7]);
  });

  it("is 0 when the query returns nothing", async () => {
    query.mockResolvedValue({ rows: [] });
    await expect(countRecommendationsToday(7)).resolves.toBe(0);
  });
});

describe("listCandidatesForRecommendation", () => {
  it("filters by company, matched state, attention score and no recommendation", async () => {
    await listCandidatesForRecommendation(7, 3);

    const [text, values] = call();
    expect(text).toContain("o.company_id = $1");
    expect(text).toContain("o.state = 'matched'");
    expect(text).toContain(`m.score >= ${ATTENTION_SCORE}`);
    expect(text).toContain("NOT EXISTS");
    expect(text).toContain("FROM recommendations r");
    expect(text).toContain("ORDER BY m.score DESC");
    expect(text).toContain("LIMIT $2");
    expect(values).toEqual([7, 3]);
  });

  it("maps bigint columns to numbers and defaults reasons", async () => {
    query.mockResolvedValue({
      rows: [
        {
          id: "10",
          procurement_id: "77",
          source_id: "12345678000199-1-000001/2026",
          score: "85",
          reasons: null,
          description: "Aquisição de lápis",
          agency_name: "Prefeitura",
          state_uf: "RJ",
          city_name: "Rio de Janeiro",
          modality_name: "Pregão",
          estimated_value: "1000.00",
          proposal_closes_at: null,
        },
      ],
    });

    const rows = await listCandidatesForRecommendation(7, 5);
    expect(rows[0]).toMatchObject({
      opportunityId: 10,
      procurementId: 77,
      score: 85,
      reasons: [],
      sourceId: "12345678000199-1-000001/2026",
    });
  });
});

describe("listCompaniesWithCandidates", () => {
  it("returns the distinct company ids with matched opportunities", async () => {
    query.mockResolvedValue({ rows: [{ company_id: "1" }, { company_id: "9" }] });

    await expect(listCompaniesWithCandidates()).resolves.toEqual([1, 9]);
    expect(call()[0]).toContain("o.state = 'matched'");
  });
});
