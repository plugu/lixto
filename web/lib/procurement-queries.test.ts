import { beforeEach, describe, expect, it, vi } from "vitest";

// The pool is mocked — the fetch* tests below never touch a live database;
// the pure builders never call it. `cache` is real so the memoisation the
// fetchers rely on is exercised.
vi.mock("./db", () => ({ pool: { query: vi.fn() } }));

import { invalidateTags, resetCache } from "./cache";
import { pool } from "./db";
import { ACTIVE_PORTALS } from "./portals";
import {
  buildSegmentFacetQuery,
  buildCountQuery,
  buildListQuery,
  buildModalityFacetQuery,
  buildModalityOptionsQuery,
  buildPortalFacetQuery,
  buildPortalOptionsQuery,
  buildStateFacetQuery,
  buildStatusFacetQuery,
  buildWhereClause,
  fetchFacetCounts,
  fetchModalityOptions,
  fetchProcurements,
  parseFilters,
  RRF_K,
  SEARCH_SEMANTIC_MIN,
  SEARCH_SEMANTIC_TOP_K,
} from "./procurement-queries";

/** A stand-in for a real 1536-d pgvector literal — the builder only ever
 * binds it, never parses it. */
const QVEC = "[0.1,0.2,0.3]";

describe("parseFilters", () => {
  it("returns an empty object when no params are present", () => {
    expect(parseFilters({})).toEqual({});
  });

  it("trims and keeps q when non-empty", () => {
    expect(parseFilters({ q: "  merenda  " })).toEqual({ q: "merenda" });
  });

  it("drops an empty/whitespace-only q", () => {
    expect(parseFilters({ q: "   " })).toEqual({});
  });

  it("unwraps array-valued q param (first value wins)", () => {
    expect(parseFilters({ q: ["a", "b"] })).toEqual({ q: "a" });
  });

  describe("portals", () => {
    it("parses a single value as a one-element array", () => {
      expect(parseFilters({ portal: "BLL Compras" })).toEqual({
        portals: ["BLL Compras"],
      });
    });

    it("parses repeated values as an array", () => {
      expect(
        parseFilters({ portal: ["Compras.gov.br", "IPM Sistemas"] }),
      ).toEqual({ portals: ["Compras.gov.br", "IPM Sistemas"] });
    });

    it("drops empty/whitespace-only entries", () => {
      expect(parseFilters({ portal: ["", "  ", "IPM Sistemas"] })).toEqual({
        portals: ["IPM Sistemas"],
      });
    });
  });

  describe("modalityIds", () => {
    it("parses a single modality as a one-element array of ids", () => {
      expect(parseFilters({ modality: "6" })).toEqual({ modalityIds: [6] });
    });

    it("parses repeated modality params as an array of ids", () => {
      expect(parseFilters({ modality: ["6", "8"] })).toEqual({
        modalityIds: [6, 8],
      });
    });

    it("drops a fully non-numeric modality", () => {
      expect(parseFilters({ modality: "abc" })).toEqual({});
    });

    it("keeps valid ids and drops invalid ones when mixed", () => {
      expect(parseFilters({ modality: ["6", "abc", "8"] })).toEqual({
        modalityIds: [6, 8],
      });
    });
  });

  describe("statuses", () => {
    it("keeps only known status values, as an array", () => {
      expect(parseFilters({ status: "open" })).toEqual({ statuses: ["open"] });
      expect(parseFilters({ status: "upcoming" })).toEqual({
        statuses: ["upcoming"],
      });
      expect(parseFilters({ status: "closed" })).toEqual({
        statuses: ["closed"],
      });
      expect(parseFilters({ status: "aberta" })).toEqual({});
    });

    it("parses repeated status params, dropping unknown values when mixed", () => {
      expect(parseFilters({ status: ["open", "bogus", "upcoming"] })).toEqual({
        statuses: ["open", "upcoming"],
      });
    });
  });

  describe("segments", () => {
    it("parses a single segment as a one-element array", () => {
      expect(parseFilters({ segment: "saude" })).toEqual({
        segments: ["saude"],
      });
    });

    it("parses repeated segment params as an array", () => {
      expect(parseFilters({ segment: ["saude", "educacao"] })).toEqual({
        segments: ["saude", "educacao"],
      });
    });
  });

  describe("states", () => {
    it("parses a single 2-letter state", () => {
      expect(parseFilters({ state: "SP" })).toEqual({ states: ["SP"] });
    });

    it("parses repeated state params", () => {
      expect(parseFilters({ state: ["SP", "MG"] })).toEqual({
        states: ["SP", "MG"],
      });
    });

    it("uppercases lowercase states", () => {
      expect(parseFilters({ state: "sp" })).toEqual({ states: ["SP"] });
    });

    it("drops values that aren't exactly 2 letters", () => {
      expect(parseFilters({ state: ["S", "SPX", "123", "SP"] })).toEqual({
        states: ["SP"],
      });
    });
  });

  describe("kind", () => {
    it("keeps only known kind values", () => {
      expect(parseFilters({ kind: "product" })).toEqual({ kind: "product" });
      expect(parseFilters({ kind: "service" })).toEqual({ kind: "service" });
      expect(parseFilters({ kind: "mixed" })).toEqual({ kind: "mixed" });
      expect(parseFilters({ kind: "bogus" })).toEqual({});
    });
  });

  describe("valueMin / valueMax", () => {
    it("parses numeric valueMin and valueMax", () => {
      expect(parseFilters({ valueMin: "50000", valueMax: "500000" })).toEqual({
        valueMin: 50000,
        valueMax: 500000,
      });
    });

    it("drops non-numeric valueMin/valueMax", () => {
      expect(parseFilters({ valueMin: "abc", valueMax: "" })).toEqual({});
    });

    it("accepts a valueMin of 0", () => {
      expect(parseFilters({ valueMin: "0" })).toEqual({ valueMin: 0 });
    });
  });

  describe("sort", () => {
    it("keeps only known sort values", () => {
      expect(parseFilters({ sort: "value_desc" })).toEqual({ sort: "value_desc" });
      expect(parseFilters({ sort: "value_asc" })).toEqual({ sort: "value_asc" });
      expect(parseFilters({ sort: "closing_asc" })).toEqual({ sort: "closing_asc" });
      expect(parseFilters({ sort: "published_desc" })).toEqual({
        sort: "published_desc",
      });
      expect(parseFilters({ sort: "nope" })).toEqual({});
      expect(parseFilters({ sort: "" })).toEqual({});
    });

    it("unwraps an array-valued sort param (first value wins)", () => {
      expect(parseFilters({ sort: ["value_asc", "value_desc"] })).toEqual({
        sort: "value_asc",
      });
    });
  });

  describe("compat", () => {
    it("sets compat: true when compat=1", () => {
      expect(parseFilters({ compat: "1" })).toEqual({ compat: true });
    });

    it("ignores any other compat value", () => {
      expect(parseFilters({ compat: "0" })).toEqual({});
      expect(parseFilters({ compat: "true" })).toEqual({});
      expect(parseFilters({ compat: "" })).toEqual({});
    });

    it("unwraps an array-valued compat param (first value wins)", () => {
      expect(parseFilters({ compat: ["1", "0"] })).toEqual({ compat: true });
    });
  });

  it("combines all filters together", () => {
    expect(
      parseFilters({
        q: "merenda",
        portal: ["BLL Compras", "IPM Sistemas"],
        modality: ["6", "8"],
        status: "open",
        segment: "saude",
        state: ["SP", "MG"],
        kind: "product",
        valueMin: "1000",
        valueMax: "9000",
        compat: "1",
      }),
    ).toEqual({
      q: "merenda",
      portals: ["BLL Compras", "IPM Sistemas"],
      modalityIds: [6, 8],
      statuses: ["open"],
      segments: ["saude"],
      states: ["SP", "MG"],
      kind: "product",
      valueMin: 1000,
      valueMax: 9000,
      compat: true,
    });
  });
});

describe("buildWhereClause", () => {
  it("always applies the top-7 portal allowlist as the base predicate, even with no filters", () => {
    const { where, values } = buildWhereClause({});
    expect(where).toBe("WHERE origin_system = ANY($1)");
    expect(values).toEqual([ACTIVE_PORTALS]);
  });

  it("builds the q predicate as a UNION of two GIN-indexable id sets (description, items)", () => {
    const { where, values } = buildWhereClause({ q: "merenda" });
    expect(values).toEqual([ACTIVE_PORTALS, "merenda"]);
    expect(where).toContain("procurements.id IN (");
    expect(where).toContain(
      "SELECT kw_p.id FROM procurements kw_p WHERE to_tsvector('portuguese', f_unaccent(coalesce(kw_p.description, ''))) @@ websearch_to_tsquery('portuguese', f_unaccent($2))",
    );
    expect(where).toContain(" UNION ");
    expect(where).toContain(
      "SELECT kw_i.procurement_id FROM procurement_items kw_i WHERE to_tsvector('portuguese', f_unaccent(coalesce(kw_i.description, ''))) @@ websearch_to_tsquery('portuguese', f_unaccent($2))",
    );
  });

  it("never ORs the description FTS with a correlated items subquery (defeats both GIN indexes: 5 s on prod)", () => {
    const { where } = buildWhereClause({ q: "merenda" });
    expect(where).not.toMatch(/@@[^)]*\)\)\s+OR\s+EXISTS/);
    expect(where).not.toContain("i.procurement_id = procurements.id");
  });

  it("builds the portals predicate as = ANY, intersected with the allowlist", () => {
    const { where, values } = buildWhereClause({
      portals: ["Compras.gov.br", "IPM Sistemas"],
    });
    expect(where).toBe(
      "WHERE origin_system = ANY($1) AND origin_system = ANY($2)",
    );
    expect(values).toEqual([ACTIVE_PORTALS, ["Compras.gov.br", "IPM Sistemas"]]);
  });

  it("builds the modalityIds predicate as = ANY, after the allowlist param", () => {
    const { where, values } = buildWhereClause({ modalityIds: [6, 8] });
    expect(where).toBe("WHERE origin_system = ANY($1) AND modality_id = ANY($2)");
    expect(values).toEqual([ACTIVE_PORTALS, [6, 8]]);
  });

  it("builds a single status predicate with no extra params", () => {
    const { where, values } = buildWhereClause({ statuses: ["open"] });
    expect(where).toBe(
      "WHERE origin_system = ANY($1) AND ((proposal_opens_at <= now() AND now() < proposal_closes_at))",
    );
    expect(values).toEqual([ACTIVE_PORTALS]);
  });

  it("OR-combines multiple statuses' date predicates", () => {
    const { where } = buildWhereClause({ statuses: ["open", "upcoming"] });
    expect(where).toBe(
      "WHERE origin_system = ANY($1) AND ((proposal_opens_at <= now() AND now() < proposal_closes_at) OR (proposal_opens_at > now()))",
    );
  });

  it("builds the segments predicate as an EXISTS against procurement_classifications", () => {
    const { where, values } = buildWhereClause({ segments: ["saude"] });
    expect(where).toBe(
      "WHERE origin_system = ANY($1) AND EXISTS (SELECT 1 FROM procurement_classifications pcl WHERE pcl.procurement_id = procurements.id AND pcl.status = 'done' AND pcl.segment = ANY($2))",
    );
    expect(values).toEqual([ACTIVE_PORTALS, ["saude"]]);
  });

  it("builds the states predicate as = ANY", () => {
    const { where, values } = buildWhereClause({ states: ["SP", "MG"] });
    expect(where).toBe("WHERE origin_system = ANY($1) AND state = ANY($2)");
    expect(values).toEqual([ACTIVE_PORTALS, ["SP", "MG"]]);
  });

  it("builds valueMin/valueMax as range predicates on estimated_value", () => {
    const { where, values } = buildWhereClause({
      valueMin: 50000,
      valueMax: 500000,
    });
    expect(where).toBe(
      "WHERE origin_system = ANY($1) AND estimated_value >= $2 AND estimated_value <= $3",
    );
    expect(values).toEqual([ACTIVE_PORTALS, 50000, 500000]);
  });

  describe("kind filter", () => {
    it("builds product as has-material-and-not-service over procurement_items", () => {
      const { where, values } = buildWhereClause({ kind: "product" });
      expect(values).toEqual([ACTIVE_PORTALS]);
      expect(where).toContain("i.kind = 'material'");
      expect(where).toContain("AND NOT EXISTS");
    });

    it("builds mixed as has-material-and-has-service", () => {
      const { where } = buildWhereClause({ kind: "mixed" });
      expect(where).toContain("i.kind = 'material'");
      expect(where).toContain("i.kind = 'service'");
      expect(where).not.toContain("NOT EXISTS");
    });
  });

  describe("compat filter", () => {
    it("builds an EXISTS against procurement_cnaes when compat is set and codes are supplied", () => {
      const { where, values } = buildWhereClause({ compat: true }, [
        "6201500",
        "4712100",
      ]);
      expect(where).toBe(
        "WHERE origin_system = ANY($1) AND EXISTS (SELECT 1 FROM procurement_cnaes pc WHERE pc.procurement_id = procurements.id AND pc.cnae_code = ANY($2))",
      );
      expect(values).toEqual([ACTIVE_PORTALS, ["6201500", "4712100"]]);
    });

    it("ignores compat when no companyCnaes are supplied (logged out / no session)", () => {
      const { where, values } = buildWhereClause({ compat: true });
      expect(where).toBe("WHERE origin_system = ANY($1)");
      expect(values).toEqual([ACTIVE_PORTALS]);
    });

    it("ignores compat when companyCnaes is an empty array", () => {
      const { where, values } = buildWhereClause({ compat: true }, []);
      expect(where).toBe("WHERE origin_system = ANY($1)");
      expect(values).toEqual([ACTIVE_PORTALS]);
    });

    it("ignores companyCnaes when compat is not set", () => {
      const { where, values } = buildWhereClause({}, ["6201500"]);
      expect(where).toBe("WHERE origin_system = ANY($1)");
      expect(values).toEqual([ACTIVE_PORTALS]);
    });
  });

  it("combines all filters with AND after the allowlist, each with correctly numbered params", () => {
    const { where, values } = buildWhereClause({
      q: "merenda",
      portals: ["BLL Compras"],
      modalityIds: [6],
      statuses: ["open"],
      segments: ["saude"],
      states: ["SP"],
      valueMin: 1000,
      valueMax: 9000,
    });
    expect(values).toEqual([
      ACTIVE_PORTALS,
      "merenda",
      ["BLL Compras"],
      [6],
      ["saude"],
      ["SP"],
      1000,
      9000,
    ]);
    expect(where).toContain("WHERE origin_system = ANY($1)");
    expect(where).toContain("origin_system = ANY($3)");
    expect(where).toContain("modality_id = ANY($4)");
    expect(where).toContain(
      "(proposal_opens_at <= now() AND now() < proposal_closes_at)",
    );
    expect(where).toContain("pcl.segment = ANY($5)");
    expect(where).toContain("state = ANY($6)");
    expect(where).toContain("estimated_value >= $7");
    expect(where).toContain("estimated_value <= $8");
  });
});

describe("buildPortalOptionsQuery", () => {
  it("restricts distinct portal options to the top-7 allowlist", () => {
    const { text, values } = buildPortalOptionsQuery();
    expect(text).toContain("origin_system = ANY($1)");
    expect(values).toEqual([ACTIVE_PORTALS]);
  });
});

describe("buildModalityOptionsQuery", () => {
  it("restricts distinct modality options to the top-7 allowlist", () => {
    const { text, values } = buildModalityOptionsQuery();
    expect(text).toContain("WHERE origin_system = ANY($1)");
    expect(text).toContain("modality_id IS NOT NULL");
    expect(text).toContain("modality_name IS NOT NULL");
    expect(text).toContain("ORDER BY modality_name");
    expect(values).toEqual([ACTIVE_PORTALS]);
  });
});

describe("buildListQuery", () => {
  it("returns the full match count as a window aggregate on the keyword path", () => {
    const { text } = buildListQuery({ q: "merenda" }, 25, 0);
    expect(text).toContain("count(*) OVER ()::text AS total");
  });

  it("appends limit/offset params after the allowlist and filter params", () => {
    const { text, values } = buildListQuery(
      { portals: ["BLL Compras"] },
      25,
      50,
    );
    expect(values).toEqual([ACTIVE_PORTALS, ["BLL Compras"], 25, 50]);
    expect(text).toContain("origin_system = ANY($1)");
    expect(text).toContain("origin_system = ANY($2)");
    expect(text).toContain("LIMIT $3 OFFSET $4");
  });

  it("uses the allowlist param plus limit/offset when no other filters are active", () => {
    const { text, values } = buildListQuery({}, 25, 0);
    expect(values).toEqual([ACTIVE_PORTALS, 25, 0]);
    expect(text).toContain("WHERE origin_system = ANY($1)");
    expect(text).toContain("LIMIT $2 OFFSET $3");
  });

  it("preserves the status-group/sort_val ordering logic", () => {
    const { text } = buildListQuery({}, 25, 0);
    expect(text).toContain("ORDER BY status_group ASC, sort_val ASC NULLS LAST");
  });

  describe("explicit sort", () => {
    it("orders by estimated_value DESC NULLS LAST for value_desc", () => {
      const { text } = buildListQuery({ sort: "value_desc" }, 25, 0);
      expect(text).toContain(
        "ORDER BY estimated_value DESC NULLS LAST, source_id",
      );
      expect(text).not.toContain("ORDER BY status_group");
    });

    it("orders by estimated_value ASC NULLS LAST for value_asc", () => {
      const { text } = buildListQuery({ sort: "value_asc" }, 25, 0);
      expect(text).toContain("ORDER BY estimated_value ASC NULLS LAST, source_id");
    });

    it("orders upcoming deadlines soonest-first, then past ones, for closing_asc", () => {
      const { text } = buildListQuery({ sort: "closing_asc" }, 25, 0);
      expect(text).toContain(
        "ORDER BY CASE WHEN proposal_closes_at >= now() THEN 0 ELSE 1 END, proposal_closes_at ASC NULLS LAST, source_id",
      );
    });

    it("orders by published_at DESC NULLS LAST for published_desc", () => {
      const { text } = buildListQuery({ sort: "published_desc" }, 25, 0);
      expect(text).toContain("ORDER BY published_at DESC NULLS LAST, source_id");
    });

    it("never binds the sort as a param", () => {
      const { values } = buildListQuery({ sort: "value_desc" }, 25, 0);
      expect(values).toEqual([ACTIVE_PORTALS, 25, 0]);
    });

    it("does not leak into the WHERE clause or the count query", () => {
      const { text, values } = buildCountQuery({ sort: "value_desc" });
      expect(text).not.toContain("ORDER BY");
      expect(values).toEqual([ACTIVE_PORTALS]);
    });
  });

  it("joins agencies for the name and flags enrichment with a LEFT JOIN", () => {
    const { text } = buildListQuery({}, 25, 0);
    expect(text).toContain("JOIN agencies ON agencies.tax_id = procurements.agency_tax_id");
    expect(text).toContain("LEFT JOIN procurement_enrichments e");
    expect(text).toContain("(e.procurement_id IS NOT NULL) AS enriched");
  });

  it("threads companyCnaes into the compat predicate with correctly numbered limit/offset params", () => {
    const { text, values } = buildListQuery({ compat: true }, 25, 0, [
      "6201500",
    ]);
    expect(text).toContain("EXISTS (SELECT 1 FROM procurement_cnaes pc");
    expect(values).toEqual([ACTIVE_PORTALS, ["6201500"], 25, 0]);
  });

  it("ignores compat when companyCnaes isn't passed", () => {
    const { text, values } = buildListQuery({ compat: true }, 25, 0);
    expect(text).not.toContain("procurement_cnaes");
    expect(values).toEqual([ACTIVE_PORTALS, 25, 0]);
  });
});

describe("buildCountQuery", () => {
  it("reuses the same WHERE clause and params as the list query", () => {
    const filters = { q: "merenda", statuses: ["open" as const] };
    const count = buildCountQuery(filters);
    const { where, values } = buildWhereClause(filters);
    expect(count.text).toContain(where);
    expect(count.values).toEqual(values);
  });

  it("always applies the allowlist WHERE clause, even with no other filters", () => {
    const { text, values } = buildCountQuery({});
    expect(text).toContain("WHERE origin_system = ANY($1)");
    expect(values).toEqual([ACTIVE_PORTALS]);
  });
});

describe("hybrid retrieval (q + query embedding)", () => {
  it("keeps the retrieval constants at their documented values", () => {
    expect(SEARCH_SEMANTIC_TOP_K).toBe(200);
    expect(SEARCH_SEMANTIC_MIN).toBe(0.4);
    expect(RRF_K).toBe(60);
  });

  describe("buildListQuery", () => {
    it("returns the total as a window aggregate with a single semantic scan", () => {
      const { text } = buildListQuery({ q: "merenda" }, 20, 0, undefined, QVEC);
      expect(text).toContain("count(*) OVER ()::text AS total");
      expect(text.split(`LIMIT ${SEARCH_SEMANTIC_TOP_K}`).length - 1).toBe(1);
    });

    it("emits the kw/sem/fused CTEs and orders by the fused rank", () => {
      const { text } = buildListQuery({ q: "merenda" }, 20, 0, undefined, QVEC);
      expect(text).toContain("WITH kw AS (");
      expect(text).toContain("sem AS (");
      expect(text).toContain("fused AS (");
      expect(text).toContain("FROM kw FULL OUTER JOIN sem USING (id)");
      expect(text).toContain("<=>");
      expect(text).toContain("ORDER BY fused.rrf DESC, source_id");
      expect(text).not.toContain("ORDER BY status_group ASC");
    });

    it("lets an explicit sort override the fused rank", () => {
      const { text } = buildListQuery(
        { q: "merenda", sort: "value_desc" },
        20,
        0,
        undefined,
        QVEC,
      );
      expect(text).toContain("fused AS (");
      expect(text).toContain(
        "ORDER BY estimated_value DESC NULLS LAST, source_id",
      );
      expect(text).not.toContain("ORDER BY fused.rrf");
    });

    it("binds q then the vector, with limit/offset last", () => {
      const { text, values } = buildListQuery(
        { q: "merenda" },
        20,
        40,
        undefined,
        QVEC,
      );
      expect(values).toEqual([ACTIVE_PORTALS, "merenda", QVEC, 20, 40]);
      expect(text).toContain("$3::vector");
      expect(text).toContain("LIMIT $4 OFFSET $5");
    });

    it("ranks the keyword branch by ts_rank and the semantic branch by distance", () => {
      const { text } = buildListQuery({ q: "merenda" }, 20, 0, undefined, QVEC);
      expect(text).toContain(
        "row_number() OVER (ORDER BY ts_rank(to_tsvector('portuguese', f_unaccent(coalesce(description, ''))), websearch_to_tsquery('portuguese', f_unaccent($2))) DESC, id) AS rank",
      );
      expect(text).toContain(
        "row_number() OVER (ORDER BY pe.embedding <=> $3::vector) AS rank",
      );
      expect(text).toContain(`LIMIT ${SEARCH_SEMANTIC_TOP_K}`);
    });

    it("fuses with reciprocal rank and labels the match kind", () => {
      const { text } = buildListQuery({ q: "merenda" }, 20, 0, undefined, QVEC);
      expect(text).toContain(
        `coalesce(1.0 / (${RRF_K} + kw.rank), 0) + coalesce(1.0 / (${RRF_K} + sem.rank), 0) AS rrf`,
      );
      expect(text).toContain(
        "WHEN kw.id IS NOT NULL AND sem.id IS NOT NULL THEN 'both'",
      );
      expect(text).toContain("WHEN kw.id IS NOT NULL THEN 'keyword'");
      expect(text).toContain("ELSE 'semantic'");
      expect(text).toContain(
        `WHERE kw.id IS NOT NULL OR sem.similarity >= ${SEARCH_SEMANTIC_MIN}`,
      );
      expect(text).toContain("fused.match_kind, fused.similarity");
    });

    it("applies the structured filters inside both branches and to the row join", () => {
      const { text, values } = buildListQuery(
        { q: "merenda", states: ["SP"], statuses: ["open"], valueMin: 1000 },
        20,
        0,
        undefined,
        QVEC,
      );
      // states/valueMin bound before q and the vector; no q param inside them.
      expect(values).toEqual([
        ACTIVE_PORTALS,
        ["SP"],
        1000,
        "merenda",
        QVEC,
        20,
        0,
      ]);
      // origin_system allowlist + state + value in kw, in sem and in classified.
      expect(text.match(/state = ANY\(\$2\)/g)?.length).toBe(3);
      expect(text.match(/estimated_value >= \$3/g)?.length).toBe(3);
      // 3 WHERE clauses + the 2 status CASE expressions of `classified`.
      expect(
        text.match(/proposal_opens_at <= now\(\) AND now\(\) < proposal_closes_at/g)
          ?.length,
      ).toBe(5);
    });

    it("keeps the q FTS predicate only in the keyword branch", () => {
      const { text } = buildListQuery({ q: "merenda" }, 20, 0, undefined, QVEC);
      expect(
        text.match(/websearch_to_tsquery\('portuguese', f_unaccent\(\$2\)\)/g)
          ?.length,
        // ts_rank (1) + description predicate (1) + items predicate (1)
      ).toBe(3);
      expect(text).toContain("SELECT kw_i.procurement_id FROM procurement_items kw_i");
    });

    it("threads companyCnaes into both branches ahead of q and the vector", () => {
      const { text, values } = buildListQuery(
        { q: "merenda", compat: true },
        20,
        0,
        ["6201500"],
        QVEC,
      );
      expect(values).toEqual([
        ACTIVE_PORTALS,
        ["6201500"],
        "merenda",
        QVEC,
        20,
        0,
      ]);
      expect(text.match(/procurement_cnaes/g)?.length).toBe(3);
    });

    it("falls back to the keyword-only path when the embedding is missing", () => {
      const plain = buildListQuery({ q: "merenda" }, 20, 0);
      expect(buildListQuery({ q: "merenda" }, 20, 0, undefined, null).text).toBe(
        plain.text,
      );
      expect(plain.text).not.toContain("<=>");
      expect(plain.text).toContain("ORDER BY status_group ASC, sort_val ASC NULLS LAST");
      expect(plain.text).toContain(
        "NULL::text AS match_kind, NULL::real AS similarity",
      );
    });

    it("ignores an embedding when there is no free text", () => {
      const { text, values } = buildListQuery({ states: ["SP"] }, 20, 0, undefined, QVEC);
      expect(text).toBe(buildListQuery({ states: ["SP"] }, 20, 0).text);
      expect(values).toEqual([ACTIVE_PORTALS, ["SP"], 20, 0]);
    });
  });

  describe("buildCountQuery", () => {
    it("counts the fused candidate set with the same params as the list", () => {
      const count = buildCountQuery({ q: "merenda" }, undefined, QVEC);
      const list = buildListQuery({ q: "merenda" }, 20, 0, undefined, QVEC);
      expect(count.text).toContain("SELECT count(*)::text AS count FROM fused");
      expect(count.text).toContain("WITH kw AS (");
      expect(count.text).toContain("sem AS (");
      expect(count.values).toEqual([ACTIVE_PORTALS, "merenda", QVEC]);
      expect(list.values.slice(0, count.values.length)).toEqual(count.values);
    });

    it("applies the structured filters to both branches", () => {
      const { text, values } = buildCountQuery(
        { q: "merenda", modalityIds: [6] },
        undefined,
        QVEC,
      );
      expect(values).toEqual([ACTIVE_PORTALS, [6], "merenda", QVEC]);
      expect(text.match(/modality_id = ANY\(\$2\)/g)?.length).toBe(2);
    });

    it("falls back to the plain count when there is no embedding", () => {
      expect(buildCountQuery({ q: "merenda" }, undefined, null).text).toBe(
        buildCountQuery({ q: "merenda" }).text,
      );
    });
  });
});

describe("facet-count query builders", () => {
  it("modality facet excludes modalityIds but keeps other active filters and the allowlist", () => {
    const { text, values } = buildModalityFacetQuery({
      modalityIds: [6],
      states: ["SP"],
    });
    expect(text).toContain("origin_system = ANY($1)");
    expect(text).not.toContain("modality_id = ANY");
    expect(text).toContain("state = ANY($2)");
    expect(text).toContain("GROUP BY modality_id, modality_name");
    expect(text).toContain("modality_id IS NOT NULL");
    expect(values).toEqual([ACTIVE_PORTALS, ["SP"]]);
  });

  it("list query no longer references the legacy category table", () => {
    const { text } = buildListQuery({ segments: ["saude"] }, 1, 20);
    expect(text).not.toContain("procurement_" + "categories");
    expect(text).toContain("procurement_classifications");
  });

  it("segment facet excludes segments but keeps other active filters", () => {
    const { text, values } = buildSegmentFacetQuery({
      segments: ["saude"],
      states: ["SP"],
    });
    expect(text).not.toContain("pcl.segment = ANY");
    expect(text).toContain("state = ANY($2)");
    expect(text).toContain("GROUP BY s.code, s.label, s.sort_order");
    expect(values).toEqual([ACTIVE_PORTALS, ["SP"]]);
  });

  it("portal facet excludes portals but keeps the base allowlist and other filters", () => {
    const { text, values } = buildPortalFacetQuery({
      portals: ["Compras.gov.br"],
      modalityIds: [6],
    });
    // Only one origin_system = ANY($1) — the allowlist; the user's own portal
    // selection is excluded from this facet's own WHERE clause.
    expect(text.match(/origin_system = ANY/g)?.length).toBe(1);
    expect(text).toContain("modality_id = ANY($2)");
    expect(text).toContain("GROUP BY origin_system");
    expect(values).toEqual([ACTIVE_PORTALS, [6]]);
  });

  it("status facet excludes statuses but keeps other active filters, using FILTER aggregates", () => {
    const { text, values } = buildStatusFacetQuery({
      statuses: ["open"],
      states: ["SP"],
    });
    expect(text).toContain("count(*) FILTER (WHERE");
    expect(text).toContain("AS open");
    expect(text).toContain("AS upcoming");
    expect(text).toContain("AS closed");
    expect(text).toContain("state = ANY($2)");
    expect(values).toEqual([ACTIVE_PORTALS, ["SP"]]);
  });

  it("state facet excludes states but keeps other active filters", () => {
    const { text, values } = buildStateFacetQuery({
      states: ["SP"],
      statuses: ["open"],
    });
    expect(text).not.toContain("state = ANY");
    expect(text).toContain("state IS NOT NULL");
    expect(text).toContain("GROUP BY state");
    expect(text).toContain(
      "(proposal_opens_at <= now() AND now() < proposal_closes_at)",
    );
    expect(values).toEqual([ACTIVE_PORTALS]);
  });
});

const query = pool.query as unknown as ReturnType<typeof vi.fn>;

function listRow(sourceId: string, total: string) {
  return {
    source_id: sourceId,
    description: "d",
    agency_name: null,
    city_name: null,
    state: null,
    modality_name: null,
    estimated_value: null,
    proposal_opens_at: null,
    proposal_closes_at: null,
    enriched: false,
    match_kind: null,
    similarity: null,
    total,
  };
}

describe("fetchProcurements", () => {
  beforeEach(() => {
    resetCache();
    query.mockReset();
  });

  it("issues one statement and reads the total off the first row", async () => {
    query.mockResolvedValueOnce({ rows: [listRow("a", "42"), listRow("b", "42")] });

    const { rows, total } = await fetchProcurements({ q: "merenda" }, 25, 0, undefined, QVEC);

    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toContain("count(*) OVER ()");
    expect(total).toBe(42);
    expect(rows.map((r) => r.source_id)).toEqual(["a", "b"]);
    expect(rows[0]).not.toHaveProperty("total");
  });

  it("returns zero without a count query for an empty first page", async () => {
    query.mockResolvedValueOnce({ rows: [] });

    const { rows, total } = await fetchProcurements({}, 25, 0);

    expect(query).toHaveBeenCalledTimes(1);
    expect(rows).toEqual([]);
    expect(total).toBe(0);
  });

  it("falls back to the count query for a page past the end", async () => {
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: "30" }] });

    const { rows, total } = await fetchProcurements({ states: ["SP"] }, 25, 50);

    expect(query).toHaveBeenCalledTimes(2);
    const count = buildCountQuery({ states: ["SP"] });
    expect(query.mock.calls[1]).toEqual([count.text, count.values]);
    expect(rows).toEqual([]);
    expect(total).toBe(30);
  });
});

describe("fetchModalityOptions", () => {
  beforeEach(() => {
    resetCache();
    query.mockReset();
    query.mockResolvedValue({ rows: [{ modality_id: 6, modality_name: "Pregão" }] });
  });

  it("runs the portal-filtered query once, then again after the sync tag drops", async () => {
    expect(await fetchModalityOptions()).toEqual([{ id: 6, name: "Pregão" }]);
    await fetchModalityOptions();
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][1]).toEqual([ACTIVE_PORTALS]);

    invalidateTags(["sync"]);
    await fetchModalityOptions();
    expect(query).toHaveBeenCalledTimes(2);
  });
});

describe("fetchFacetCounts", () => {
  beforeEach(() => {
    resetCache();
    query.mockReset();
    query.mockResolvedValue({ rows: [] });
  });

  it("memoises per filter set regardless of key order", async () => {
    await fetchFacetCounts({ q: "merenda", states: ["SP"] });
    expect(query).toHaveBeenCalledTimes(5);

    await fetchFacetCounts({ states: ["SP"], q: "merenda" });
    expect(query).toHaveBeenCalledTimes(5);

    await fetchFacetCounts({ states: ["RJ"], q: "merenda" });
    expect(query).toHaveBeenCalledTimes(10);
  });

  it("reloads after the sync tag drops", async () => {
    await fetchFacetCounts({});
    invalidateTags(["sync"]);
    await fetchFacetCounts({});
    expect(query).toHaveBeenCalledTimes(10);
  });
});
