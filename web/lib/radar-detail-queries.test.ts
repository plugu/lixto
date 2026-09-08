import { beforeEach, describe, expect, it, vi } from "vitest";

// Relative imports (not "@/lib/...") on purpose: vitest runs without a config
// file. The pool is mocked — these tests never touch a live database.
vi.mock("./db", () => ({ pool: { query: vi.fn() } }));

import { pool } from "./db";
import {
  buildClearRadarAction,
  buildFetchRadarDetail,
  buildSetRadarAction,
  clearRadarAction,
  fetchRadarDetail,
  pncpPlanUrl,
  setRadarAction,
} from "./radar-detail-queries";

const query = pool.query as unknown as ReturnType<typeof vi.fn>;

function dbRow(over: Record<string, unknown> = {}) {
  return {
    id: "171",
    title: "PRESTAÇÃO DE SERVIÇO DE LIMPEZA E CONSERVAÇÃO",
    state: "MG",
    city_name: "Uberaba",
    estimated_value: "219093.00",
    expected_date: new Date("2026-12-31"),
    plan_year: 2026,
    opportunity_score: 85,
    signals: [{ code: "pca_item", weight: 50, detail: "x" }],
    match_score: 65,
    reasons: [{ code: "term_text", weight: 40, detail: "y" }],
    action_state: null,
    agency_name: "IF Sudeste MG",
    agency_tax_id: "10695891000100",
    unit_name: "Campus Sete Lagoas",
    unit_code: "158099",
    source_id: "10695891000100-0-000001/2026",
    year: 2026,
    published_at: new Date("2026-01-10"),
    source_global_updated_at: new Date("2026-08-25"),
    pdm_description: "Serviço",
    catalog_classification_name: "SERVIÇOS DE LIMPEZA",
    superior_classification_name: null,
    estimated_quantity: "1.0000",
    unit_value: "219093.0000",
    supply_unit: "-",
    requesting_unit: null,
    contracting_group_name: "CONS 147/2026",
    source_updated_at: new Date("2026-05-27"),
    item_live: true,
    ...over,
  };
}

beforeEach(() => {
  query.mockReset();
  query.mockResolvedValue({ rows: [] });
});

describe("buildFetchRadarDetail", () => {
  it("binds companyId as $1 and id as $2", () => {
    const { text, values } = buildFetchRadarDetail(1, 171);

    expect(text).toContain("m.company_id = $1");
    expect(text).toContain("a.company_id = $1");
    expect(text).toContain("WHERE fo.id = $2");
    expect(values).toEqual([1, 171]);
  });

  it("joins the tenant-scoped match, agencies, plan, live item and unit", () => {
    const { text } = buildFetchRadarDetail(1, 171);

    expect(text).toContain("JOIN future_opportunity_matches m");
    expect(text).toContain("LEFT JOIN future_opportunity_actions a");
    expect(text).toContain("JOIN agencies ag ON ag.tax_id = fo.agency_tax_id");
    expect(text).toContain("JOIN procurement_plans p ON p.id = fo.plan_id");
    expect(text).toContain(
      "LEFT JOIN procurement_plan_items i\n      ON (i.plan_id, i.item_number) = (fo.plan_id, fo.item_number)",
    );
    expect(text).toContain(
      "LEFT JOIN agency_units u\n      ON u.agency_tax_id = p.agency_tax_id AND u.code = p.unit_code",
    );
    expect(text).toContain("(i.plan_id IS NOT NULL) AS item_live");
  });
});

describe("fetchRadarDetail", () => {
  it("maps the bigint id to a number", async () => {
    query.mockResolvedValueOnce({ rows: [dbRow()] });
    const detail = await fetchRadarDetail(1, 171);

    expect(detail?.id).toBe(171);
    expect(detail?.opportunity_score).toBe(85);
    expect(detail?.match_score).toBe(65);
  });

  it("is null when the company has no match row (or the id doesn't exist)", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    expect(await fetchRadarDetail(1, 999999999)).toBe(null);
  });

  it("carries item_live=false when the live PCA item is gone", async () => {
    query.mockResolvedValueOnce({
      rows: [dbRow({ item_live: false, source_updated_at: null })],
    });
    const detail = await fetchRadarDetail(1, 171);
    expect(detail?.item_live).toBe(false);
  });
});

describe("buildSetRadarAction", () => {
  it("verifies ownership inside the insert and upserts on conflict", () => {
    const { text, values } = buildSetRadarAction(1, 171, 5, "saved");

    expect(text).toContain("INSERT INTO future_opportunity_actions");
    expect(text).toContain("FROM future_opportunities fo");
    expect(text).toContain("JOIN future_opportunity_matches m");
    expect(text).toContain("m.company_id = $1");
    expect(text).toContain("WHERE fo.id = $2");
    expect(text).toContain("ON CONFLICT (company_id, future_opportunity_id) DO UPDATE");
    expect(values).toEqual([1, 171, "saved", 5]);
  });
});

describe("buildClearRadarAction", () => {
  it("binds company_id and future_opportunity_id", () => {
    const { text, values } = buildClearRadarAction(1, 171);

    expect(text).toContain("DELETE FROM future_opportunity_actions");
    expect(text).toContain("WHERE company_id = $1 AND future_opportunity_id = $2");
    expect(values).toEqual([1, 171]);
  });
});

describe("setRadarAction / clearRadarAction", () => {
  it("setRadarAction runs the built query", async () => {
    await setRadarAction(1, 171, 5, "ignored");
    const [text, values] = query.mock.calls[0];
    expect(text).toContain("INSERT INTO future_opportunity_actions");
    expect(values).toEqual([1, 171, "ignored", 5]);
  });

  it("clearRadarAction runs the built query", async () => {
    await clearRadarAction(1, 171);
    const [text, values] = query.mock.calls[0];
    expect(text).toContain("DELETE FROM future_opportunity_actions");
    expect(values).toEqual([1, 171]);
  });
});

describe("pncpPlanUrl", () => {
  it("parses the trailing sequence out of a real dev source_id", () => {
    expect(pncpPlanUrl("10695891000100", 2026, "10695891000100-0-000001/2026")).toBe(
      "https://pncp.gov.br/app/pca/10695891000100/2026/1",
    );
  });

  it("strips leading zeros from the sequence", () => {
    expect(pncpPlanUrl("10764307000112", 2026, "10764307000112-0-000071/2026")).toBe(
      "https://pncp.gov.br/app/pca/10764307000112/2026/71",
    );
  });

  it("falls back to the bare PCA URL when the shape doesn't match", () => {
    expect(pncpPlanUrl("10695891000100", 2026, "not-a-real-id")).toBe(
      "https://pncp.gov.br/app/pca",
    );
  });
});
