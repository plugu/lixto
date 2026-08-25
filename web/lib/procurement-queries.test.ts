import { describe, expect, it } from "vitest";
import { ACTIVE_PORTALS } from "./portals";
import {
  buildCategoryFacetQuery,
  buildCountQuery,
  buildListQuery,
  buildModalityFacetQuery,
  buildPortalFacetQuery,
  buildPortalOptionsQuery,
  buildStateFacetQuery,
  buildStatusFacetQuery,
  buildWhereClause,
  parseFilters,
} from "./procurement-queries";

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

  describe("categories", () => {
    it("parses a single category as a one-element array", () => {
      expect(parseFilters({ category: "saude" })).toEqual({
        categories: ["saude"],
      });
    });

    it("parses repeated category params as an array", () => {
      expect(parseFilters({ category: ["saude", "educacao"] })).toEqual({
        categories: ["saude", "educacao"],
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
        category: "saude",
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
      categories: ["saude"],
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

  it("builds the q predicate against description and procurement_items.description", () => {
    const { where, values } = buildWhereClause({ q: "merenda" });
    expect(values).toEqual([ACTIVE_PORTALS, "merenda"]);
    expect(where).toContain(
      "to_tsvector('portuguese', f_unaccent(coalesce(description, ''))) @@ websearch_to_tsquery('portuguese', f_unaccent($2))",
    );
    expect(where).toContain("EXISTS (");
    expect(where).toContain("i.procurement_id = procurements.id");
    expect(where).toContain(
      "to_tsvector('portuguese', f_unaccent(coalesce(i.description, ''))) @@ websearch_to_tsquery('portuguese', f_unaccent($2))",
    );
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

  it("builds the categories predicate as an EXISTS against procurement_categories", () => {
    const { where, values } = buildWhereClause({ categories: ["saude"] });
    expect(where).toBe(
      "WHERE origin_system = ANY($1) AND EXISTS (SELECT 1 FROM procurement_categories pc WHERE pc.procurement_id = procurements.id AND pc.category = ANY($2))",
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
      categories: ["saude"],
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
    expect(where).toContain("pc.category = ANY($5)");
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

describe("buildListQuery", () => {
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

  it("category facet excludes categories but keeps other active filters", () => {
    const { text, values } = buildCategoryFacetQuery({
      categories: ["saude"],
      states: ["SP"],
    });
    expect(text).not.toContain("pc.category = ANY");
    expect(text).toContain("state = ANY($2)");
    expect(text).toContain("GROUP BY c.category");
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
