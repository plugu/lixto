import { describe, expect, it } from "vitest";
import {
  buildRadarCountQuery,
  buildRadarListQuery,
  buildRadarStateOptionsQuery,
  parseRadarFilters,
  type RadarFilters,
} from "./radar-list-queries";

const BASE_FILTERS: RadarFilters = {
  view: "all",
  states: [],
  period: null,
  minValue: null,
  maxValue: null,
  minScore: null,
};

describe("parseRadarFilters", () => {
  it("defaults to view 'all' with no other filters when nothing is present", () => {
    expect(parseRadarFilters({})).toEqual(BASE_FILTERS);
  });

  describe("view", () => {
    it("accepts 'saved' and 'ignored'", () => {
      expect(parseRadarFilters({ view: "saved" }).view).toBe("saved");
      expect(parseRadarFilters({ view: "ignored" }).view).toBe("ignored");
    });

    it("falls back to 'all' for an unknown value", () => {
      expect(parseRadarFilters({ view: "bogus" }).view).toBe("all");
    });

    it("unwraps an array-valued view param (first value wins)", () => {
      expect(parseRadarFilters({ view: ["saved", "ignored"] }).view).toBe(
        "saved",
      );
    });
  });

  describe("states", () => {
    it("parses a single 2-letter state, uppercased", () => {
      expect(parseRadarFilters({ state: "rj" }).states).toEqual(["RJ"]);
    });

    it("parses repeated state params", () => {
      expect(parseRadarFilters({ state: ["RJ", "SP"] }).states).toEqual([
        "RJ",
        "SP",
      ]);
    });

    it("drops values that aren't exactly 2 letters", () => {
      expect(
        parseRadarFilters({ state: ["R", "RJX", "123", "RJ"] }).states,
      ).toEqual(["RJ"]);
    });
  });

  describe("period", () => {
    it("accepts each documented period value", () => {
      for (const p of [30, 60, 90, 180, 365]) {
        expect(parseRadarFilters({ period: String(p) }).period).toBe(p);
      }
    });

    it("drops an unlisted period value", () => {
      expect(parseRadarFilters({ period: "45" }).period).toBeNull();
    });

    it("drops a non-numeric period", () => {
      expect(parseRadarFilters({ period: "abc" }).period).toBeNull();
    });

    it("defaults to null when absent", () => {
      expect(parseRadarFilters({}).period).toBeNull();
    });
  });

  describe("minValue / maxValue / minScore", () => {
    it("parses numeric values", () => {
      const filters = parseRadarFilters({
        minValue: "1000",
        maxValue: "50000",
        minScore: "60",
      });
      expect(filters.minValue).toBe(1000);
      expect(filters.maxValue).toBe(50000);
      expect(filters.minScore).toBe(60);
    });

    it("drops non-numeric values", () => {
      const filters = parseRadarFilters({
        minValue: "abc",
        maxValue: "",
        minScore: "xyz",
      });
      expect(filters.minValue).toBeNull();
      expect(filters.maxValue).toBeNull();
      expect(filters.minScore).toBeNull();
    });

    it("accepts a minScore of 0", () => {
      expect(parseRadarFilters({ minScore: "0" }).minScore).toBe(0);
    });
  });

  it("combines all filters together", () => {
    expect(
      parseRadarFilters({
        view: "saved",
        state: ["RJ", "SP"],
        period: "90",
        minValue: "1000",
        maxValue: "9000",
        minScore: "60",
      }),
    ).toEqual({
      view: "saved",
      states: ["RJ", "SP"],
      period: 90,
      minValue: 1000,
      maxValue: 9000,
      minScore: 60,
    });
  });
});

describe("buildRadarListQuery", () => {
  it("binds companyId as $1 and joins matches/actions/agencies/plans", () => {
    const { text, values } = buildRadarListQuery(7, BASE_FILTERS, 25, 0);
    expect(values[0]).toBe(7);
    expect(text).toContain(
      "JOIN future_opportunity_matches m\n        ON m.future_opportunity_id = fo.id AND m.company_id = $1",
    );
    expect(text).toContain(
      "LEFT JOIN future_opportunity_actions a\n        ON a.future_opportunity_id = fo.id AND a.company_id = $1",
    );
    expect(text).toContain("JOIN agencies ag ON ag.tax_id = fo.agency_tax_id");
    expect(text).toContain("JOIN procurement_plans p ON p.id = fo.plan_id");
  });

  it("selects the documented columns", () => {
    const { text } = buildRadarListQuery(7, BASE_FILTERS, 25, 0);
    for (const col of [
      "fo.id",
      "fo.title",
      "fo.state",
      "fo.estimated_value",
      "fo.expected_date",
      "fo.plan_year",
      "fo.opportunity_score",
      "fo.signals",
      "m.match_score",
      "m.reasons",
      "a.state AS action_state",
      "ag.name AS agency_name",
      "p.unit_name",
    ]) {
      expect(text).toContain(col);
    }
  });

  it("only ever considers predicted opportunities", () => {
    const { text } = buildRadarListQuery(7, BASE_FILTERS, 25, 0);
    expect(text).toContain("fo.status = 'predicted'");
  });

  it("excludes ignored rows on the default 'all' view", () => {
    const { text } = buildRadarListQuery(7, BASE_FILTERS, 25, 0);
    expect(text).toContain("(a.state IS NULL OR a.state <> 'ignored')");
  });

  it("restricts to saved rows on the 'saved' view", () => {
    const { text } = buildRadarListQuery(
      7,
      { ...BASE_FILTERS, view: "saved" },
      25,
      0,
    );
    expect(text).toContain("a.state = 'saved'");
  });

  it("restricts to ignored rows on the 'ignored' view", () => {
    const { text } = buildRadarListQuery(
      7,
      { ...BASE_FILTERS, view: "ignored" },
      25,
      0,
    );
    expect(text).toContain("a.state = 'ignored'");
  });

  it("builds the states predicate as = ANY, after companyId", () => {
    const { text, values } = buildRadarListQuery(
      7,
      { ...BASE_FILTERS, states: ["RJ", "SP"] },
      25,
      0,
    );
    expect(text).toContain("fo.state = ANY($2)");
    expect(values).toEqual([7, ["RJ", "SP"], 25, 0]);
  });

  it("builds the period predicate against current_date", () => {
    const { text, values } = buildRadarListQuery(
      7,
      { ...BASE_FILTERS, period: 90 },
      25,
      0,
    );
    expect(text).toContain("fo.expected_date <= current_date + $2::int");
    expect(values).toEqual([7, 90, 25, 0]);
  });

  it("builds minValue/maxValue as range predicates on estimated_value", () => {
    const { text, values } = buildRadarListQuery(
      7,
      { ...BASE_FILTERS, minValue: 1000, maxValue: 50000 },
      25,
      0,
    );
    expect(text).toContain("fo.estimated_value >= $2");
    expect(text).toContain("fo.estimated_value <= $3");
    expect(values).toEqual([7, 1000, 50000, 25, 0]);
  });

  it("builds minScore as a predicate on match_score", () => {
    const { text, values } = buildRadarListQuery(
      7,
      { ...BASE_FILTERS, minScore: 60 },
      25,
      0,
    );
    expect(text).toContain("m.match_score >= $2");
    expect(values).toEqual([7, 60, 25, 0]);
  });

  it("orders by match score, then opportunity score, then expected date, then id", () => {
    const { text } = buildRadarListQuery(7, BASE_FILTERS, 25, 0);
    expect(text).toContain(
      "ORDER BY m.match_score DESC, fo.opportunity_score DESC, fo.expected_date ASC NULLS LAST, fo.id",
    );
  });

  it("appends limit/offset last, after every active filter param", () => {
    const { text, values } = buildRadarListQuery(
      7,
      { ...BASE_FILTERS, states: ["RJ"], period: 90, minScore: 60 },
      25,
      50,
    );
    expect(values).toEqual([7, ["RJ"], 90, 60, 25, 50]);
    expect(text).toContain("LIMIT $5 OFFSET $6");
  });
});

describe("buildRadarCountQuery", () => {
  it("reuses the same WHERE clause and params as the list query, without limit/offset", () => {
    const filters: RadarFilters = { ...BASE_FILTERS, states: ["RJ"], minScore: 60 };
    const count = buildRadarCountQuery(7, filters);
    const list = buildRadarListQuery(7, filters, 25, 0);
    expect(list.values.slice(0, count.values.length)).toEqual(count.values);
    expect(count.text).toContain("fo.status = 'predicted'");
    expect(count.text).toContain("fo.state = ANY($2)");
    expect(count.text).toContain("m.match_score >= $3");
  });

  it("selects total and total_value as sum(estimated_value)", () => {
    const { text } = buildRadarCountQuery(7, BASE_FILTERS);
    expect(text).toContain("count(*)::text AS total");
    expect(text).toContain(
      "coalesce(sum(fo.estimated_value), 0)::text AS total_value",
    );
  });
});

describe("buildRadarStateOptionsQuery", () => {
  it("binds companyId as $1 and restricts to this company's predicted matches", () => {
    const { text, values } = buildRadarStateOptionsQuery(7);
    expect(values).toEqual([7]);
    expect(text).toContain("JOIN future_opportunity_matches m");
    expect(text).toContain("m.company_id = $1");
    expect(text).toContain("fo.status = 'predicted'");
    expect(text).toContain("fo.state IS NOT NULL");
    expect(text).toContain("SELECT DISTINCT fo.state");
  });
});
