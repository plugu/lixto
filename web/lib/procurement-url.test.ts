import { describe, expect, it } from "vitest";
import { parseFilters, type ProcurementFilters } from "./procurement-queries";
import {
  buildProcurementQueryString,
  parseProcurementPage,
  parseProcurementSearchParams,
  searchParamsToRecord,
} from "./procurement-url";

/** Every field the frozen URL contract carries, including multi-values on all
 * five repeated-key dimensions. */
const FULL_FIXTURE: ProcurementFilters = {
  q: "merenda escolar",
  portals: ["Compras.gov.br", "IPM Sistemas"],
  modalityIds: [6, 8],
  statuses: ["open", "upcoming"],
  kind: "service",
  categories: ["Alimentação", "Serviços gerais"],
  states: ["SP", "RJ"],
  valueMin: 1000,
  valueMax: 250000,
  compat: true,
  sort: "value_desc",
};

function roundTrip(filters: ProcurementFilters, page?: number) {
  const params = new URLSearchParams(buildProcurementQueryString(filters, page));
  return parseFilters(searchParamsToRecord(params));
}

describe("buildProcurementQueryString", () => {
  it("round-trips a fixture with every field through the real parseFilters", () => {
    expect(roundTrip(FULL_FIXTURE)).toEqual(FULL_FIXTURE);
  });

  it("emits repeated keys (never comma-joined) for multi-value filters", () => {
    const qs = buildProcurementQueryString(FULL_FIXTURE);
    const params = new URLSearchParams(qs);
    expect(params.getAll("state")).toEqual(["SP", "RJ"]);
    expect(params.getAll("modality")).toEqual(["6", "8"]);
    expect(params.getAll("status")).toEqual(["open", "upcoming"]);
    expect(params.getAll("portal")).toEqual([
      "Compras.gov.br",
      "IPM Sistemas",
    ]);
    expect(params.getAll("category")).toEqual([
      "Alimentação",
      "Serviços gerais",
    ]);
    expect(qs).not.toContain(",");
  });

  it("returns an empty string for empty filters", () => {
    expect(buildProcurementQueryString({})).toBe("");
    expect(roundTrip({})).toEqual({});
  });

  it("omits page for a filter change and for page 1", () => {
    expect(buildProcurementQueryString(FULL_FIXTURE)).not.toContain("page");
    expect(buildProcurementQueryString(FULL_FIXTURE, 1)).not.toContain("page");
    expect(buildProcurementQueryString({}, 1)).toBe("");
  });

  it("emits page beyond the first", () => {
    const params = new URLSearchParams(buildProcurementQueryString({}, 4));
    expect(params.get("page")).toBe("4");
  });

  it("drops compat when false and empty multi-value arrays", () => {
    expect(
      buildProcurementQueryString({
        compat: false,
        states: [],
        modalityIds: [],
      }),
    ).toBe("");
  });

  it("keeps valueMin/valueMax of 0", () => {
    expect(roundTrip({ valueMin: 0, valueMax: 0 })).toEqual({
      valueMin: 0,
      valueMax: 0,
    });
  });
});

describe("parseProcurementSearchParams", () => {
  const cases: Array<[string, string]> = [
    ["empty", ""],
    ["full fixture", buildProcurementQueryString(FULL_FIXTURE)],
    ["single values", "?q=lapis&state=sp&modality=6&status=open&portal=BLL"],
    ["blank q", "?q=%20%20&state=SP"],
    ["invalid state", "?state=SPX&state=rj&state="],
    ["invalid modality", "?modality=abc&modality=7"],
    ["unknown status", "?status=cancelled&status=closed"],
    ["unknown kind", "?kind=nope"],
    ["non-numeric range", "?valueMin=abc&valueMax=10"],
    ["compat off", "?compat=0"],
    ["repeated q wins first", "?q=a&q=b"],
    ["unknown params ignored", "?foo=bar&page=3"],
    ["sort", "?sort=closing_asc"],
    ["unknown sort", "?sort=random"],
    ["repeated sort wins first", "?sort=value_asc&sort=value_desc"],
  ];

  for (const [name, qs] of cases) {
    it(`agrees with the server parseFilters — ${name}`, () => {
      const params = new URLSearchParams(qs);
      expect(parseProcurementSearchParams(params)).toEqual(
        parseFilters(searchParamsToRecord(params)),
      );
    });
  }
});

describe("parseProcurementPage", () => {
  it("defaults to 1", () => {
    expect(parseProcurementPage(new URLSearchParams(""))).toBe(1);
  });

  it("parses a valid page", () => {
    expect(parseProcurementPage(new URLSearchParams("?page=7"))).toBe(7);
  });

  it("clamps junk and out-of-range values to 1", () => {
    expect(parseProcurementPage(new URLSearchParams("?page=abc"))).toBe(1);
    expect(parseProcurementPage(new URLSearchParams("?page=0"))).toBe(1);
    expect(parseProcurementPage(new URLSearchParams("?page=-3"))).toBe(1);
  });
});
