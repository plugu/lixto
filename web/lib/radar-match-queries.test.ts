import { beforeEach, describe, expect, it, vi } from "vitest";

// Relative imports (not "@/lib/...") on purpose: vitest runs without a config
// file. The pool is mocked — these tests never touch a live database.
vi.mock("./db", () => ({ pool: { query: vi.fn() } }));

import { pool } from "./db";
import type { Reason } from "./match-engine";
import {
  buildPruneRadarMatchesQuery,
  buildRadarCandidateQuery,
  buildUpsertRadarMatchesQuery,
  listCompaniesWithProfile,
  loadRadarProfile,
  pruneRadarMatches,
  upsertRadarMatches,
  type RadarProfile,
} from "./radar-match-queries";

const query = pool.query as unknown as ReturnType<typeof vi.fn>;

function profile(over: Partial<RadarProfile> = {}): RadarProfile {
  return {
    terms: ["lapis"],
    exclusion_terms: [],
    states: [],
    min_value: null,
    max_value: null,
    size: "ME",
    embedding: null,
    ...over,
  };
}

beforeEach(() => {
  query.mockReset();
});

describe("buildRadarCandidateQuery", () => {
  it("binds companyId as $1 and never interpolates it", () => {
    const q = buildRadarCandidateQuery(42, profile());
    expect(q.values[0]).toBe(42);
    expect(q.text).toContain("$1::bigint AS company_id");
    expect(q.text).not.toContain("42");
  });

  it("uses the exact index expression for the title FTS (no coalesce)", () => {
    // migrations/005_radar.sql: gin (to_tsvector('portuguese', f_unaccent(title)))
    const q = buildRadarCandidateQuery(1, profile());
    expect(q.text).toContain("to_tsvector('portuguese', f_unaccent(fo.title))");
    expect(q.text).not.toContain("coalesce(fo.title");
  });

  it("always filters on status = predicted", () => {
    const q = buildRadarCandidateQuery(1, profile());
    expect(q.text).toContain("fo.status = 'predicted'");
  });

  it("binds the terms tsquery via buildTermsTsQuery", () => {
    const q = buildRadarCandidateQuery(1, profile({ terms: ["lapis", "lapis preto"] }));
    expect(q.values).toContainEqual("(lapis) | (lapis & preto)");
  });

  it("binds null for empty terms/exclusions and collapses to false", () => {
    const q = buildRadarCandidateQuery(1, profile({ terms: [], exclusion_terms: [] }));
    expect(q.text).toContain("IS NULL THEN false");
  });

  it("selects NULL::real as similarity and skips the CTE with no embedding", () => {
    const q = buildRadarCandidateQuery(1, profile());
    expect(q.text).toContain("NULL::real AS similarity");
    expect(q.text).not.toContain("<=>");
    expect(q.text).not.toContain("LEFT JOIN s");
    expect(q.text).not.toContain("s.similarity >=");
  });

  it("adds the pgvector CTE and binds the vector as text when given", () => {
    const q = buildRadarCandidateQuery(1, profile({ embedding: "[0.1,0.2,0.3]" }));

    expect(q.text).toContain("s AS (");
    expect(q.text).toContain("1 - (e.embedding <=> $");
    expect(q.text).toContain("::vector");
    expect(q.text).toContain("FROM plan_item_embeddings e");
    expect(q.text).toContain(
      "ON (fo2.plan_id, fo2.item_number) = (e.plan_id, e.item_number)",
    );
    expect(q.text).toContain("LEFT JOIN s ON s.future_opportunity_id = fo.id");
    expect(q.text).toContain("s.similarity >= 0.40");
    expect(q.values.filter((v) => v === "[0.1,0.2,0.3]")).toHaveLength(1);
    expect(q.text).not.toContain("0.1,0.2,0.3");
  });

  it("defaults the candidate limit to 500 and honours an override", () => {
    const byDefault = buildRadarCandidateQuery(1, profile());
    expect(byDefault.values[byDefault.values.length - 1]).toBe(500);

    const custom = buildRadarCandidateQuery(1, profile(), 50);
    expect(custom.values[custom.values.length - 1]).toBe(50);
  });

  it("numbers every placeholder it uses, with no gaps", () => {
    const q = buildRadarCandidateQuery(1, profile({ embedding: "[0.1,0.2]" }));
    const used = new Set([...q.text.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])));
    for (let i = 1; i <= q.values.length; i++) {
      expect(used.has(i)).toBe(true);
    }
    expect(Math.max(...used)).toBe(q.values.length);
  });
});

describe("loadRadarProfile", () => {
  /** Three statements, in order: getProfile, the size lookup,
   * getProfileEmbeddingText. */
  function mockCompany(
    profileRow: Record<string, unknown> | null,
    size: string | null,
    embedding: string | null = null,
  ) {
    query
      .mockResolvedValueOnce({ rows: profileRow ? [profileRow] : [] })
      .mockResolvedValueOnce({ rows: size === null ? [] : [{ size }] })
      .mockResolvedValueOnce({ rows: [{ embedding }] });
  }

  it("returns the profile fields plus size and embedding", async () => {
    mockCompany(
      {
        company_id: 1,
        products: ["lápis"],
        keywords: [],
        exclusions: [],
        terms: ["lapis"],
        exclusion_terms: ["arma"],
        states: ["RJ"],
        min_value: "100.00",
        max_value: "9999.00",
        notes: null,
        embedding_text: null,
      },
      "ME",
      "[0.1,0.2,0.3]",
    );

    const result = await loadRadarProfile(1);

    expect(result).toEqual({
      terms: ["lapis"],
      exclusion_terms: ["arma"],
      states: ["RJ"],
      min_value: "100.00",
      max_value: "9999.00",
      size: "ME",
      embedding: "[0.1,0.2,0.3]",
    });
  });

  it("defaults to empty terms/states and null embedding with no profile row", async () => {
    mockCompany(null, null, null);

    const result = await loadRadarProfile(1);

    expect(result).toEqual({
      terms: [],
      exclusion_terms: [],
      states: [],
      min_value: null,
      max_value: null,
      size: null,
      embedding: null,
    });
  });
});

describe("buildUpsertRadarMatchesQuery / upsertRadarMatches", () => {
  const reasons: Reason[] = [
    { code: "term_text", weight: 40, detail: "Termos do perfil encontrados" },
  ];

  it("binds companyId as $1 and one tuple per row", () => {
    const q = buildUpsertRadarMatchesQuery(1, [
      { id: 7, score: 80, reasons },
      { id: 8, score: 60, reasons },
    ]);

    expect(q.values[0]).toBe(1);
    expect(q.text).toContain("INSERT INTO future_opportunity_matches");
    expect(q.text).toContain(
      "ON CONFLICT (company_id, future_opportunity_id) DO UPDATE",
    );
    expect(q.text.match(/\(\$1,/g)).toHaveLength(2);
    expect(q.values).toContain(7);
    expect(q.values).toContain(8);
    expect(q.values).toContain(80);
    expect(q.values).toContain(60);
    expect(q.values).toContainEqual(JSON.stringify(reasons));
  });

  it("upsertRadarMatches no-ops on an empty list", async () => {
    await upsertRadarMatches(1, []);
    expect(query).not.toHaveBeenCalled();
  });

  it("upsertRadarMatches queries the pool with the built statement", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await upsertRadarMatches(1, [{ id: 7, score: 80, reasons }]);

    expect(query).toHaveBeenCalledTimes(1);
    const [text, values] = query.mock.calls[0];
    expect(text).toContain("INSERT INTO future_opportunity_matches");
    expect(values[0]).toBe(1);
  });
});

describe("buildPruneRadarMatchesQuery / pruneRadarMatches", () => {
  it("binds companyId as $1 and the kept ids as $2::bigint[]", () => {
    const q = buildPruneRadarMatchesQuery(1, [7, 8]);

    expect(q.text).toContain("DELETE FROM future_opportunity_matches m");
    expect(q.text).toContain("m.company_id = $1");
    expect(q.text).toContain("$2::bigint[]");
    expect(q.values).toEqual([1, [7, 8]]);
  });

  it("keeps rows whose opportunity is still predicted and in the kept set", () => {
    const q = buildPruneRadarMatchesQuery(1, []);
    expect(q.text).toContain("fo.status = 'predicted'");
  });

  it("pruneRadarMatches returns the deleted row count", async () => {
    query.mockResolvedValueOnce({ rows: [], rowCount: 3 });
    const deleted = await pruneRadarMatches(1, [7]);

    expect(deleted).toBe(3);
    const [text, values] = query.mock.calls[0];
    expect(text).toContain("DELETE FROM future_opportunity_matches");
    expect(values).toEqual([1, [7]]);
  });
});

describe("listCompaniesWithProfile", () => {
  it("selects company_id from company_profiles, ordered", async () => {
    query.mockResolvedValueOnce({ rows: [{ company_id: "3" }, { company_id: "10" }] });

    const ids = await listCompaniesWithProfile();

    expect(ids).toEqual([3, 10]);
    const [text] = query.mock.calls[0];
    expect(text).toContain("SELECT company_id FROM company_profiles ORDER BY company_id");
  });
});
