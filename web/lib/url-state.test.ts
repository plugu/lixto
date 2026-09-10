import { describe, expect, it } from "vitest";
import { parseChartScope } from "./stats-queries";
import { parseRadarFilters } from "./radar-list-queries";
import {
  CHART_SCOPE_DEFAULT,
  CHART_SCOPES,
  OPPORTUNITY_VIEW_DEFAULT,
  OPPORTUNITY_VIEWS,
  parseOpportunityView,
  RADAR_VIEW_DEFAULT,
  RADAR_VIEWS,
} from "./url-state";

describe("CHART_SCOPES", () => {
  it("defaults to open", () => {
    expect(CHART_SCOPE_DEFAULT).toBe("open");
    expect(CHART_SCOPES).toEqual(["open", "upcoming", "all"]);
  });

  it("parseChartScope accepts exactly the CHART_SCOPES values", () => {
    for (const value of CHART_SCOPES) {
      expect(parseChartScope(value)).toBe(value);
    }
    expect(parseChartScope("bogus")).toBe(CHART_SCOPE_DEFAULT);
    expect(parseChartScope(undefined)).toBe(CHART_SCOPE_DEFAULT);
    expect(parseChartScope(["all", "open"])).toBe("all");
  });
});

describe("OPPORTUNITY_VIEWS", () => {
  it("defaults to attention", () => {
    expect(OPPORTUNITY_VIEW_DEFAULT).toBe("attention");
    expect(OPPORTUNITY_VIEWS).toEqual(["attention", "all", "dismissed"]);
  });

  it("parseOpportunityView accepts exactly the OPPORTUNITY_VIEWS values", () => {
    for (const value of OPPORTUNITY_VIEWS) {
      expect(parseOpportunityView(value)).toBe(value);
    }
    expect(parseOpportunityView("bogus")).toBe(OPPORTUNITY_VIEW_DEFAULT);
    expect(parseOpportunityView(undefined)).toBe(OPPORTUNITY_VIEW_DEFAULT);
    expect(parseOpportunityView(["dismissed", "all"])).toBe("dismissed");
  });
});

describe("RADAR_VIEWS", () => {
  it("defaults to all", () => {
    expect(RADAR_VIEW_DEFAULT).toBe("all");
    expect(RADAR_VIEWS).toEqual(["all", "saved", "ignored"]);
  });

  it("parseRadarFilters(...).view accepts exactly the RADAR_VIEWS values", () => {
    for (const value of RADAR_VIEWS) {
      expect(parseRadarFilters({ view: value }).view).toBe(value);
    }
    expect(parseRadarFilters({ view: "bogus" }).view).toBe(RADAR_VIEW_DEFAULT);
    expect(parseRadarFilters({}).view).toBe(RADAR_VIEW_DEFAULT);
    expect(parseRadarFilters({ view: ["saved", "all"] }).view).toBe("saved");
  });
});
