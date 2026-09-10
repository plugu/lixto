import { describe, expect, it } from "vitest";
import { searchParamsToRecord } from "./procurement-url";
import { parseRadarFilters, type RadarFilters } from "./radar-list-queries";
import {
  buildRadarQueryString,
  parseRadarPage,
  parseRadarSearchParams,
} from "./radar-url";

/** Every field the frozen URL contract carries, including a non-default
 * `view` and multiple states. */
const FULL_FIXTURE: RadarFilters = {
  view: "saved",
  states: ["SP", "RJ"],
  period: 90,
  minValue: 1000,
  maxValue: 250000,
  minScore: 40,
};

function roundTrip(filters: RadarFilters, page?: number) {
  const params = new URLSearchParams(buildRadarQueryString(filters, page));
  return parseRadarFilters(searchParamsToRecord(params));
}

describe("buildRadarQueryString", () => {
  it("round-trips a fixture with every field through the real parseRadarFilters", () => {
    expect(roundTrip(FULL_FIXTURE)).toEqual(FULL_FIXTURE);
  });

  it("emits repeated keys (never comma-joined) for state", () => {
    const qs = buildRadarQueryString(FULL_FIXTURE);
    const params = new URLSearchParams(qs);
    expect(params.getAll("state")).toEqual(["SP", "RJ"]);
    expect(qs).not.toContain(",");
  });

  it("omits view when it is the default ('all')", () => {
    const qs = buildRadarQueryString({ ...FULL_FIXTURE, view: "all" });
    expect(new URLSearchParams(qs).has("view")).toBe(false);
  });

  it("returns an empty string for empty filters", () => {
    const empty: RadarFilters = {
      view: "all",
      states: [],
      period: null,
      minValue: null,
      maxValue: null,
      minScore: null,
    };
    expect(buildRadarQueryString(empty)).toBe("");
    expect(roundTrip(empty)).toEqual(empty);
  });

  it("omits page for a filter change and for page 1", () => {
    expect(buildRadarQueryString(FULL_FIXTURE)).not.toContain("page");
    expect(buildRadarQueryString(FULL_FIXTURE, 1)).not.toContain("page");
  });

  it("emits page beyond the first", () => {
    const params = new URLSearchParams(buildRadarQueryString(FULL_FIXTURE, 4));
    expect(params.get("page")).toBe("4");
  });

  it("keeps minValue/maxValue/minScore of 0", () => {
    const zeroed: RadarFilters = {
      view: "all",
      states: [],
      period: null,
      minValue: 0,
      maxValue: 0,
      minScore: 0,
    };
    expect(roundTrip(zeroed)).toEqual(zeroed);
  });
});

describe("parseRadarSearchParams", () => {
  const cases: Array<[string, string]> = [
    ["empty", ""],
    ["full fixture", buildRadarQueryString(FULL_FIXTURE)],
    ["single values", "?view=ignored&state=sp&period=30&minValue=10"],
    ["blank state", "?state=%20%20&state=SP"],
    ["invalid state", "?state=SPX&state=rj&state="],
    ["invalid period", "?period=45"],
    ["non-numeric period", "?period=abc"],
    ["unknown view", "?view=bogus"],
    ["non-numeric range", "?minValue=abc&maxValue=10"],
    ["unknown params ignored", "?foo=bar&page=3"],
  ];

  for (const [name, qs] of cases) {
    it(`agrees with the server parseRadarFilters — ${name}`, () => {
      const params = new URLSearchParams(qs);
      expect(parseRadarSearchParams(params)).toEqual(
        parseRadarFilters(searchParamsToRecord(params)),
      );
    });
  }
});

describe("parseRadarPage", () => {
  it("defaults to 1", () => {
    expect(parseRadarPage(new URLSearchParams(""))).toBe(1);
  });

  it("parses a valid page", () => {
    expect(parseRadarPage(new URLSearchParams("?page=7"))).toBe(7);
  });

  it("clamps junk and out-of-range values to 1", () => {
    expect(parseRadarPage(new URLSearchParams("?page=abc"))).toBe(1);
    expect(parseRadarPage(new URLSearchParams("?page=0"))).toBe(1);
    expect(parseRadarPage(new URLSearchParams("?page=-3"))).toBe(1);
  });
});
