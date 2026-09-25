import { beforeEach, describe, expect, it, vi } from "vitest";

// Relative imports (not "@/lib/...") on purpose: vitest runs without a config
// file. The pool is mocked — these tests never touch a live database.
vi.mock("./db", () => ({ pool: { query: vi.fn() } }));

import { pool } from "./db";
import { ACTIVE_PORTALS } from "./portals";
import type { ProfileSummary } from "./match-engine";
import {
  buildCandidateQuery,
  buildTermsTsQuery,
  fetchMatches,
  type MatchFilters,
} from "./match-queries";

const query = pool.query as unknown as ReturnType<typeof vi.fn>;

type Profile = ProfileSummary & { exclusion_terms: string[] };

function profile(over: Partial<Profile> = {}): Profile {
  return {
    terms: ["lapis"],
    exclusion_terms: [],
    states: [],
    min_value: null,
    max_value: null,
    size: "ME",
    ...over,
  };
}

function candidate(over: Record<string, unknown> = {}) {
  return {
    source_id: "12345678000199-1-000001/2026",
    description: "Aquisição de lápis",
    agency_name: "Prefeitura",
    city_name: "Rio de Janeiro",
    state: "RJ",
    modality_name: "Pregão",
    estimated_value: "1000.00",
    proposal_opens_at: new Date("2026-09-01T12:00:00Z"),
    proposal_closes_at: new Date("2026-09-30T12:00:00Z"),
    summary: null,
    risks: null,
    complexity: null,
    enriched: false,
    cnae_hits_primary: [],
    cnae_hits_secondary: [],
    term_hits: [],
    text_hit: false,
    exclusion_hit: false,
    me_epp_exclusive: null,
    requires_certification: null,
    requires_technical_certificate: null,
    similarity: null,
    ...over,
  };
}

beforeEach(() => {
  query.mockReset();
});

describe("buildTermsTsQuery", () => {
  it("builds an OR of AND-joined terms", () => {
    expect(buildTermsTsQuery(["lapis", "lapis preto"])).toBe(
      "(lapis) | (lapis & preto)",
    );
  });

  it("returns null for an empty list", () => {
    expect(buildTermsTsQuery([])).toBe(null);
  });

  it("sanitizes each term to [a-z0-9 ], so no operator can leak through", () => {
    expect(buildTermsTsQuery(["lápis:*! | caneta", "papel-a4"])).toBe(
      "(l & pis & caneta) | (papel & a4)",
    );
  });

  it("drops terms left empty by sanitization", () => {
    expect(buildTermsTsQuery(["!!!", "lapis"])).toBe("(lapis)");
    expect(buildTermsTsQuery(["!!!", "  "])).toBe(null);
  });
});

describe("buildCandidateQuery", () => {
  it("binds companyId as $1 and never interpolates it", () => {
    const q = buildCandidateQuery(42, {}, profile(), 200);
    expect(q.values[0]).toBe(42);
    expect(q.text).toContain("FROM company_cnaes WHERE company_id = $1");
    expect(q.text).not.toContain("42");
  });

  it("always applies the portal allowlist, bound as a parameter", () => {
    const q = buildCandidateQuery(1, {}, profile(), 200);
    expect(q.text).toContain("p.origin_system = ANY(");
    expect(q.values).toContainEqual(ACTIVE_PORTALS);
  });

  it("defaults to open OR upcoming and honours explicit statuses", () => {
    const byDefault = buildCandidateQuery(1, {}, profile(), 200);
    expect(byDefault.text).toContain("p.proposal_opens_at > now()");
    expect(byDefault.text).toContain(
      "p.proposal_opens_at <= now() AND now() < p.proposal_closes_at",
    );
    expect(byDefault.text).not.toContain("p.proposal_closes_at < now()");

    const closed = buildCandidateQuery(1, { statuses: ["closed"] }, profile(), 200);
    expect(closed.text).toContain("p.proposal_closes_at < now()");
    expect(closed.text).not.toContain("p.proposal_opens_at > now()");
  });

  it("binds the terms tsquery and the terms array", () => {
    const q = buildCandidateQuery(
      1,
      {},
      profile({ terms: ["lapis", "lapis preto"] }),
      200,
    );
    expect(q.values[1]).toEqual(["lapis", "lapis preto"]);
    expect(q.values[2]).toBe("(lapis) | (lapis & preto)");
  });

  it("binds null for empty terms and exclusions", () => {
    const q = buildCandidateQuery(
      1,
      {},
      profile({ terms: [], exclusion_terms: [] }),
      200,
    );
    expect(q.values[1]).toEqual([]);
    expect(q.values[2]).toBe(null);
    expect(q.values[3]).toBe(null);
    // The FTS predicate collapses to a plain false rather than NULL.
    expect(q.text).toContain("IS NULL THEN false");
  });

  it("includes source_id = ANY only when sourceIds is given", () => {
    const without = buildCandidateQuery(1, {}, profile(), 200);
    expect(without.text).not.toContain("p.source_id = ANY(");

    const withIds = buildCandidateQuery(1, { sourceIds: ["a", "b"] }, profile(), 200);
    expect(withIds.text).toContain("p.source_id = ANY(");
    expect(withIds.values).toContainEqual(["a", "b"]);
  });

  it("requires at least one signal, except when sourceIds is given", () => {
    const without = buildCandidateQuery(1, {}, profile(), 200);
    expect(without.text).toContain(
      "FROM procurement_cnaes pc JOIN company_codes c ON c.cnae_code = pc.cnae_code",
    );

    const withIds = buildCandidateQuery(1, { sourceIds: ["a"] }, profile(), 200);
    // The facts still select CNAE hits; only the WHERE-side signal is dropped.
    expect(withIds.text).not.toContain(
      "SELECT 1 FROM procurement_cnaes pc JOIN company_codes c",
    );
  });

  it("binds enrichedSince and requires a non-null enrichment row", () => {
    const since = new Date("2026-08-01T00:00:00Z");
    const q = buildCandidateQuery(1, { enrichedSince: since }, profile(), 200);
    expect(q.text).toContain("e.enriched_at > $");
    expect(q.values).toContainEqual(since);
    expect(q.text).not.toContain("2026-08-01");

    const without = buildCandidateQuery(1, {}, profile(), 200);
    expect(without.text).not.toContain("e.enriched_at");
  });

  it("binds every optional filter as a parameter", () => {
    const filters: MatchFilters = {
      q: "lapis",
      states: ["RJ"],
      modalityIds: [6, 8],
      valueMin: 1000,
      valueMax: 500000,
    };
    const q = buildCandidateQuery(7, filters, profile(), 200);
    expect(q.text).toContain("p.state = ANY(");
    expect(q.text).toContain("p.modality_id = ANY(");
    expect(q.text).toContain("p.estimated_value >= $");
    expect(q.text).toContain("p.estimated_value <= $");
    expect(q.text).toContain("websearch_to_tsquery('portuguese', f_unaccent($");
    expect(q.values).toContainEqual(["RJ"]);
    expect(q.values).toContainEqual([6, 8]);
    expect(q.values).toContain(1000);
    expect(q.values).toContain(500000);
    expect(q.values).toContain("lapis");
    expect(q.text).not.toContain("'lapis'");
  });

  it("joins enrichment and binds the candidate limit", () => {
    const q = buildCandidateQuery(1, {}, profile(), 200);
    expect(q.text).toContain("LEFT JOIN procurement_enrichments e");
    expect(q.text).toContain("ON e.procurement_id = p.id AND e.status = 'done'");
    expect(q.text).toContain("ORDER BY p.proposal_closes_at ASC NULLS LAST");
    expect(q.text).toContain(`LIMIT $${q.values.length}`);
    expect(q.values[q.values.length - 1]).toBe(200);
  });

  it("numbers every placeholder it uses, with no gaps", () => {
    const q = buildCandidateQuery(1, { q: "lapis", states: ["RJ"] }, profile(), 200);
    const used = new Set([...q.text.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])));
    for (let i = 1; i <= q.values.length; i++) {
      expect(used.has(i)).toBe(true);
    }
    expect(Math.max(...used)).toBe(q.values.length);
  });

  it("selects NULL::real as similarity when there is no profile embedding", () => {
    const q = buildCandidateQuery(1, {}, profile(), 200);
    expect(q.text).toContain("NULL::real AS similarity");
    expect(q.text).not.toContain("<=>");
    expect(q.text).not.toContain("LEFT JOIN semantic");
    expect(
      q.values.every((v) => typeof v !== "string" || !v.startsWith("[")),
    ).toBe(true);
  });

  it("adds the pgvector CTE and binds the vector as text when given", () => {
    const vector = "[0.1,0.2,0.3]";
    const q = buildCandidateQuery(1, {}, profile(), 200, vector);

    expect(q.text).toContain("semantic AS (");
    expect(q.text).toContain("1 - (embedding <=> $");
    expect(q.text).toContain("::vector");
    expect(q.text).toContain("LEFT JOIN semantic s");
    expect(q.text).toContain("s.similarity");
    expect(q.text).toContain("FROM procurement_embeddings");
    // Bound exactly once and never interpolated.
    expect(q.values.filter((v) => v === vector)).toHaveLength(1);
    expect(q.text).not.toContain("0.1,0.2,0.3");
  });

  it("never uses OR EXISTS for FTS: text_hit, exclusion_hit and q are id IN (… UNION …)", () => {
    const q = buildCandidateQuery(
      1,
      { q: "lapis" },
      profile({ terms: ["lapis"], exclusion_terms: ["risco"] }),
      200,
    );
    expect(q.text).not.toContain("OR EXISTS");
    expect(q.text).not.toContain("i.procurement_id = p.id");

    // `kw_p`/`kw_i` UNION aliases appear once per FTS predicate site: the
    // text_hit column, the exclusion_hit column, text_hit reused inside the
    // "at least one signal" OR (both via ftsHit, using to_tsquery), and q
    // (using websearch_to_tsquery) — four `id IN (… UNION …)` predicates.
    const idInOccurrences = q.text.split("id IN (").length - 1;
    expect(idInOccurrences).toBe(4);
    const toTsqueryUnions = q.text.split("@@ to_tsquery(").length - 1;
    expect(toTsqueryUnions).toBe(6); // 3 sites × 2 branches (text_hit ×2, exclusion_hit)
    const websearchUnions = q.text.split("@@ websearch_to_tsquery(").length - 1;
    expect(websearchUnions).toBe(2); // 2 branches × q
    expect(
      q.text.split("SELECT kw_p.id FROM procurements kw_p").length - 1,
    ).toBe(4);
    expect(
      q.text.split("SELECT kw_i.procurement_id FROM procurement_items kw_i")
        .length - 1,
    ).toBe(4);
  });

  it("scopes the semantic CTE to the active portal allowlist and open/upcoming status", () => {
    const vector = "[0.1,0.2,0.3]";
    const q = buildCandidateQuery(1, {}, profile(), 200, vector);

    expect(q.text).toContain("JOIN procurements sp ON sp.id = procurement_embeddings.procurement_id");
    expect(q.text).toContain("sp.origin_system = ANY(");
    expect(q.text).toContain(
      "sp.proposal_opens_at <= now() AND now() < sp.proposal_closes_at",
    );
    expect(q.text).toContain("sp.proposal_opens_at > now()");

    // Same bound ACTIVE_PORTALS value/placeholder reused, not bound twice.
    expect(q.values.filter((v) => v === ACTIVE_PORTALS)).toHaveLength(1);

    const closed = buildCandidateQuery(
      1,
      { statuses: ["closed"] },
      profile(),
      200,
      vector,
    );
    expect(closed.text).toContain("sp.proposal_closes_at < now()");
    expect(closed.text).not.toContain("sp.proposal_opens_at > now()");
  });

  it("accepts the similarity as a standalone signal", () => {
    const q = buildCandidateQuery(1, {}, profile(), 200, "[0.1,0.2]");
    expect(q.text).toContain("OR s.similarity >= 0.40");

    const without = buildCandidateQuery(1, {}, profile(), 200);
    expect(without.text).not.toContain("s.similarity >=");
  });

  it("still numbers every placeholder with no gaps with the vector bound", () => {
    const q = buildCandidateQuery(
      1,
      { q: "lapis", states: ["RJ"] },
      profile(),
      200,
      "[0.1,0.2]",
    );
    const used = new Set([...q.text.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])));
    for (let i = 1; i <= q.values.length; i++) {
      expect(used.has(i)).toBe(true);
    }
    expect(Math.max(...used)).toBe(q.values.length);
  });
});

describe("fetchMatches", () => {
  /** Four statements, in order: getProfile, the size lookup,
   * getProfileEmbeddingText, then the candidate query (mock.calls[3]). */
  function mockCompany(
    profileRow: Record<string, unknown> | null,
    size: string | null,
    candidates: Record<string, unknown>[],
    embedding: string | null = null,
  ) {
    query
      .mockResolvedValueOnce({ rows: profileRow ? [profileRow] : [] })
      .mockResolvedValueOnce({ rows: size === null ? [] : [{ size }] })
      .mockResolvedValueOnce({ rows: [{ embedding }] })
      .mockResolvedValueOnce({ rows: candidates });
  }

  const profileRow = {
    company_id: 1,
    products: ["lápis"],
    keywords: [],
    exclusions: [],
    terms: ["lapis"],
    exclusion_terms: [],
    states: ["RJ"],
    min_value: null,
    max_value: null,
    notes: null,
    embedding_text: null,
  };

  it("scores rows, sorts by score desc and returns reasons", async () => {
    mockCompany(profileRow, "ME", [
      candidate({ source_id: "weak", text_hit: true }),
      candidate({
        source_id: "strong",
        cnae_hits_primary: ["4761003"],
        term_hits: ["lapis", "caneta"],
      }),
    ]);

    const rows = await fetchMatches(1, { q: "lapis", states: ["RJ"] });

    expect(rows.map((r) => r.source_id)).toEqual(["strong", "weak"]);
    expect(rows[0].score).toBe(90);
    expect(rows[0].reasons.map((r) => r.code)).toEqual([
      "cnae_primary",
      "term_enrichment",
      "state_ok",
      "value_ok",
    ]);
    expect(rows[1].score).toBe(35);
  });

  it("breaks score ties by proposal_closes_at ascending", async () => {
    mockCompany(profileRow, "ME", [
      candidate({
        source_id: "late",
        text_hit: true,
        proposal_closes_at: new Date("2026-12-01T12:00:00Z"),
      }),
      candidate({
        source_id: "no-deadline",
        text_hit: true,
        proposal_closes_at: null,
      }),
      candidate({
        source_id: "early",
        text_hit: true,
        proposal_closes_at: new Date("2026-09-01T12:00:00Z"),
      }),
    ]);

    const rows = await fetchMatches(1, {});

    expect(rows.map((r) => r.source_id)).toEqual(["early", "late", "no-deadline"]);
  });

  it("truncates to limit", async () => {
    mockCompany(
      profileRow,
      "ME",
      [1, 2, 3, 4, 5].map((n) => candidate({ source_id: `n${n}`, text_hit: true })),
    );

    const rows = await fetchMatches(1, {}, 2);

    expect(rows).toHaveLength(2);
  });

  it("uses the default candidate cap and honours an explicit one", async () => {
    mockCompany(profileRow, "ME", []);
    await fetchMatches(1, {});
    const [, defaultValues] = query.mock.calls[3];
    expect(defaultValues[defaultValues.length - 1]).toBe(200);

    query.mockReset();
    mockCompany(profileRow, "ME", []);
    await fetchMatches(1, {}, 1000, 500);
    const [, values] = query.mock.calls[3];
    expect(values[values.length - 1]).toBe(500);
  });

  it("scores an ME/EPP-exclusive procurement 40 lower for a LARGE company", async () => {
    const row = candidate({
      cnae_hits_primary: ["4761003"],
      term_hits: ["lapis"],
      me_epp_exclusive: true,
    });

    mockCompany(profileRow, "ME", [row]);
    const [asMe] = await fetchMatches(1, {});

    query.mockReset();
    mockCompany(profileRow, "LARGE", [row]);
    const [asLarge] = await fetchMatches(1, {});

    expect(asMe.score - asLarge.score).toBe(40);
    expect(asLarge.reasons.map((r) => r.code)).toContain("me_epp_exclusive");
    expect(asMe.reasons.map((r) => r.code)).not.toContain("me_epp_exclusive");
  });

  it("falls back to empty terms/states when the company has no profile row", async () => {
    mockCompany(null, "ME", [candidate({ cnae_hits_secondary: ["4789099"] })]);

    const rows = await fetchMatches(1, {});

    const [, values] = query.mock.calls[3];
    expect(values[0]).toBe(1);
    expect(values[1]).toEqual([]);
    expect(values[2]).toBe(null);
    // CNAE-only matching still works: 25 + 10 (any state) + 10 (any value).
    expect(rows[0].score).toBe(45);
  });

  it("never interpolates filter values into the SQL text", async () => {
    mockCompany(profileRow, "ME", []);

    await fetchMatches(1, {
      q: "lapis'; DROP TABLE procurements; --",
      states: ["RJ"],
    });

    const [text, values] = query.mock.calls[3];
    expect(text).not.toContain("DROP TABLE");
    expect(values).toContain("lapis'; DROP TABLE procurements; --");
  });

  it("passes the profile embedding to the candidate query and scores it", async () => {
    mockCompany(
      profileRow,
      "ME",
      [candidate({ term_hits: ["lapis"], similarity: "0.62" })],
      "[0.1,0.2,0.3]",
    );

    const rows = await fetchMatches(1, {});

    const [text, values] = query.mock.calls[3];
    expect(text).toContain("<=>");
    expect(values).toContain("[0.1,0.2,0.3]");
    expect(rows[0].reasons.map((r) => r.code)).toContain("semantic_high");
    expect(
      rows[0].reasons.find((r) => r.code === "semantic_high")?.detail,
    ).toBe("sim=0.62");
    // 25 (1 term) + 10 (state) + 10 (value) + 20 (semantic)
    expect(rows[0].score).toBe(65);
  });

  it("omits the vector CTE when the company has no embedding", async () => {
    mockCompany(profileRow, "ME", [candidate({ term_hits: ["lapis"] })]);

    const rows = await fetchMatches(1, {});

    const [text] = query.mock.calls[3];
    expect(text).not.toContain("<=>");
    expect(rows[0].reasons.map((r) => r.code)).not.toContain("semantic");
    expect(rows[0].score).toBe(45);
  });
});
