import { beforeEach, describe, expect, it, vi } from "vitest";

// Relative imports (not "@/lib/...") on purpose: vitest runs without a config
// file. Every query module is mocked — these tests never touch a database, and
// mocking them also keeps `db.ts` (and its pool) out of the module graph.
vi.mock("../procurement-queries", () => ({ fetchProcurements: vi.fn() }));
vi.mock("../match-queries", () => ({ fetchMatches: vi.fn() }));
vi.mock("../profile-queries", () => ({ getProfile: vi.fn() }));
vi.mock("../company-queries", () => ({ getCompanyCnaes: vi.fn() }));
vi.mock("../enrichment-queries", () => ({ fetchEnrichment: vi.fn() }));
vi.mock("../procurement-detail-queries", () => ({
  fetchProcurementDetail: vi.fn(),
  fetchItems: vi.fn(),
  fetchDocuments: vi.fn(),
}));
vi.mock("../opportunity-queries", () => ({
  ATTENTION_SCORE: 70,
  listOpportunities: vi.fn(),
  getOpportunity: vi.fn(),
}));
vi.mock("./embed", () => ({ embedQuery: vi.fn() }));

import { getCompanyCnaes } from "../company-queries";
import { fetchEnrichment } from "../enrichment-queries";
import { fetchMatches } from "../match-queries";
import { getOpportunity, listOpportunities } from "../opportunity-queries";
import {
  fetchDocuments,
  fetchItems,
  fetchProcurementDetail,
} from "../procurement-detail-queries";
import { fetchProcurements } from "../procurement-queries";
import { getProfile } from "../profile-queries";
import { embedQuery } from "./embed";
import {
  asIntArray,
  asNumber,
  asState,
  asStringArray,
  executeTool,
  TOOL_DEFINITIONS,
} from "./tools";
import type { ToolContext } from "./types";

const mock = <T>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

const SOURCE_ID = "12345678000199-1-000123/2026";
const OTHER = "12345678000199-1-000124/2026";

const CTX: ToolContext = { companyId: 7, size: "ME", companyName: "Alfa Ltda" };

const OPENS_AT = new Date("2026-01-01T12:00:00Z");
const CLOSES_AT = new Date("2999-01-01T12:00:00Z");

function procurementRow(over: Record<string, unknown> = {}) {
  return {
    source_id: SOURCE_ID,
    description: "Aquisição de lápis preto nº 2",
    agency_name: "Prefeitura do Rio de Janeiro",
    city_name: "Rio de Janeiro",
    state: "RJ",
    modality_name: "Pregão Eletrônico",
    estimated_value: "18400.00",
    proposal_opens_at: OPENS_AT,
    proposal_closes_at: CLOSES_AT,
    ...over,
  };
}

function matchRow(over: Record<string, unknown> = {}) {
  return {
    ...procurementRow(),
    summary: null,
    risks: null,
    complexity: null,
    enriched: true,
    score: 72,
    reasons: [{ code: "cnae_primary", weight: 35, detail: "4761-0/03" }],
    ...over,
  };
}

function detailRow(over: Record<string, unknown> = {}) {
  return {
    ...procurementRow(),
    id: 123,
    unit_name: "Secretaria de Educação",
    dispute_mode_name: "Aberto",
    status_name: "Divulgada no PNCP",
    is_price_registry: false,
    origin_url: "https://exemplo.gov.br/1",
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  mock(fetchProcurements).mockResolvedValue({ rows: [], total: 0 });
  mock(fetchMatches).mockResolvedValue([]);
  mock(getProfile).mockResolvedValue(null);
  mock(getCompanyCnaes).mockResolvedValue([
    { cnae_code: "4761003", is_primary: true },
  ]);
  mock(fetchProcurementDetail).mockResolvedValue(null);
  mock(fetchItems).mockResolvedValue([]);
  mock(fetchDocuments).mockResolvedValue([]);
  mock(fetchEnrichment).mockResolvedValue(null);
  mock(listOpportunities).mockResolvedValue([]);
  mock(getOpportunity).mockResolvedValue(null);
  mock(embedQuery).mockResolvedValue(null);
});

function opportunityRow(over: Record<string, unknown> = {}) {
  return {
    id: 1,
    company_id: 7,
    procurement_id: 123,
    source_id: SOURCE_ID,
    state: "matched",
    score: 82,
    reasons: [{ code: "cnae_primary", weight: 35, detail: "4761-0/03" }],
    attention: true,
    computed_at: OPENS_AT,
    description: "Aquisição de lápis preto nº 2",
    agency_name: "Prefeitura do Rio de Janeiro",
    state_uf: "RJ",
    city_name: "Rio de Janeiro",
    modality_name: "Pregão Eletrônico",
    estimated_value: "18400.00",
    proposal_closes_at: CLOSES_AT,
    verdict: null,
    rationale: null,
    ...over,
  };
}

describe("TOOL_DEFINITIONS", () => {
  it("declares the seven tools with object schemas", () => {
    expect(TOOL_DEFINITIONS.map((t) => t.name)).toEqual([
      "search_procurements",
      "search_my_matches",
      "get_procurement",
      "calculate_match",
      "analyze_procurement",
      "list_opportunities",
      "explain_opportunity",
    ]);
    for (const tool of TOOL_DEFINITIONS) {
      expect(tool.parameters.type).toBe("object");
      expect(tool.description.length).toBeGreaterThan(20);
    }
  });

  it("never exposes a companyId parameter to the model", () => {
    const json = JSON.stringify(TOOL_DEFINITIONS);
    expect(json).not.toContain("companyId");
    expect(json).not.toContain("company_id");
  });
});

describe("argument helpers", () => {
  it("asStringArray keeps non-empty strings only", () => {
    expect(asStringArray(["a", " b ", "", 3, null])).toEqual(["a", "b"]);
    expect(asStringArray("a")).toEqual([]);
  });

  it("asIntArray accepts integers and numeric strings", () => {
    expect(asIntArray([6, "8", 1.5, "x", null])).toEqual([6, 8]);
    expect(asIntArray(6)).toEqual([]);
  });

  it("asNumber accepts finite numbers and numeric strings", () => {
    expect(asNumber(10)).toBe(10);
    expect(asNumber("10.5")).toBe(10.5);
    expect(asNumber("dez")).toBeUndefined();
    expect(asNumber(Number.NaN)).toBeUndefined();
  });

  it("asState uppercases known UFs and drops the rest", () => {
    expect(asState("rj")).toBe("RJ");
    expect(asState(" sp ")).toBe("SP");
    expect(asState("XX")).toBeUndefined();
    expect(asState(11)).toBeUndefined();
  });
});

describe("search_procurements", () => {
  it("defaults to open, normalizes states and returns refs with status", async () => {
    mock(fetchProcurements).mockResolvedValue({
      rows: [procurementRow()],
      total: 1,
    });

    const res = await executeTool(
      "search_procurements",
      { q: "lápis", states: ["rj"] },
      CTX,
    );

    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const [filters, limit, offset] = mock(fetchProcurements).mock.calls[0];
    expect(filters).toEqual({ q: "lápis", states: ["RJ"], statuses: ["open"] });
    expect(limit).toBe(10);
    expect(offset).toBe(0);

    expect(res.refs).toHaveLength(1);
    expect(res.refs[0]).toMatchObject({
      source_id: SOURCE_ID,
      state: "RJ",
      city: "Rio de Janeiro",
      modality: "Pregão Eletrônico",
      estimated_value: "18400.00",
      status: "open",
    });
    expect(res.refs[0].closes_at).toBe(CLOSES_AT.toISOString());
    expect(res.data).toEqual({ total: 1, items: res.refs });
  });

  it("clamps limit to 1..20 and drops invalid filter values", async () => {
    await executeTool(
      "search_procurements",
      { limit: 500, states: ["ZZ"], statuses: ["nope"], modalityIds: ["6", "x"] },
      CTX,
    );
    expect(mock(fetchProcurements).mock.calls[0][1]).toBe(20);
    expect(mock(fetchProcurements).mock.calls[0][0]).toEqual({
      statuses: ["open"],
      modalityIds: [6],
    });

    await executeTool("search_procurements", { limit: 0 }, CTX);
    expect(mock(fetchProcurements).mock.calls[1][1]).toBe(1);
  });

  it("honours explicit statuses and value bounds", async () => {
    await executeTool(
      "search_procurements",
      { statuses: ["closed", "upcoming"], valueMin: "1000", valueMax: 5000 },
      CTX,
    );
    expect(mock(fetchProcurements).mock.calls[0][0]).toEqual({
      statuses: ["closed", "upcoming"],
      valueMin: 1000,
      valueMax: 5000,
    });
  });

  it("returns a short error (not a stack trace) when the query fails", async () => {
    mock(fetchProcurements).mockRejectedValue(new Error("connection refused"));
    expect(await executeTool("search_procurements", {}, CTX)).toEqual({
      ok: false,
      error: "falha ao consultar",
    });
  });

  it("embeds q once and passes the vector to fetchProcurements as the 5th arg", async () => {
    mock(embedQuery).mockResolvedValue("[0.1,0.2,0.3]");

    await executeTool("search_procurements", { q: "material escolar" }, CTX);

    expect(embedQuery).toHaveBeenCalledTimes(1);
    expect(embedQuery).toHaveBeenCalledWith("material escolar");
    const call = mock(fetchProcurements).mock.calls[0];
    expect(call[4]).toBe("[0.1,0.2,0.3]");
  });

  it("skips embedding when q is absent — 5th arg is undefined", async () => {
    await executeTool("search_procurements", { states: ["rj"] }, CTX);

    expect(embedQuery).not.toHaveBeenCalled();
    const call = mock(fetchProcurements).mock.calls[0];
    expect(call[4]).toBeUndefined();
  });

  it("degrades to keyword-only (5th arg null) when embedQuery resolves null", async () => {
    mock(embedQuery).mockResolvedValue(null);

    await executeTool("search_procurements", { q: "lápis" }, CTX);

    expect(embedQuery).toHaveBeenCalledWith("lápis");
    const call = mock(fetchProcurements).mock.calls[0];
    expect(call[4]).toBeNull();
  });

  it("copies match_kind from the row onto the ref", async () => {
    mock(fetchProcurements).mockResolvedValue({
      rows: [procurementRow({ match_kind: "semantic", similarity: 0.82 })],
      total: 1,
    });

    const res = await executeTool(
      "search_procurements",
      { q: "material escolar" },
      CTX,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.refs[0].match_kind).toBe("semantic");
  });
});

describe("search_my_matches", () => {
  it("uses ctx.companyId, never one supplied in the arguments", async () => {
    mock(fetchMatches).mockResolvedValue([matchRow()]);

    const res = await executeTool(
      "search_my_matches",
      { q: "lápis", companyId: 999, company_id: 999 },
      CTX,
    );

    const [companyId, filters, limit] = mock(fetchMatches).mock.calls[0];
    expect(companyId).toBe(7);
    expect(filters).toEqual({ q: "lápis", statuses: ["open", "upcoming"] });
    expect(limit).toBe(10);
    expect(JSON.stringify(filters)).not.toContain("999");

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.refs[0].score).toBe(72);
    expect(res.refs[0].reasons).toEqual([
      { code: "cnae_primary", weight: 35, detail: "4761-0/03" },
    ]);
  });

  it("returns the warning when the company has no profile and no CNAEs", async () => {
    mock(getProfile).mockResolvedValue(null);
    mock(getCompanyCnaes).mockResolvedValue([]);

    expect(await executeTool("search_my_matches", {}, CTX)).toEqual({
      ok: true,
      data: {
        warning: "perfil de match não configurado",
        url: "/company/profile",
      },
      refs: [],
    });
    expect(fetchMatches).not.toHaveBeenCalled();
  });

  it("still matches on CNAEs alone when there is no profile row", async () => {
    mock(getProfile).mockResolvedValue(null);
    mock(fetchMatches).mockResolvedValue([matchRow()]);

    const res = await executeTool("search_my_matches", {}, CTX);
    expect(res.ok).toBe(true);
    expect(fetchMatches).toHaveBeenCalledTimes(1);
  });
});

describe("get_procurement", () => {
  it("rejects a malformed sourceId without touching the database", async () => {
    expect(await executeTool("get_procurement", { sourceId: "123" }, CTX)).toEqual({
      ok: false,
      error: "número de controle inválido",
    });
    expect(await executeTool("get_procurement", {}, CTX)).toEqual({
      ok: false,
      error: "número de controle inválido",
    });
    expect(fetchProcurementDetail).not.toHaveBeenCalled();
  });

  it("reports a missing procurement", async () => {
    mock(fetchProcurementDetail).mockResolvedValue(null);
    expect(
      await executeTool("get_procurement", { sourceId: SOURCE_ID }, CTX),
    ).toEqual({ ok: false, error: "licitação não encontrada" });
  });

  it("keys the children on the numeric id", async () => {
    mock(fetchProcurementDetail).mockResolvedValue(detailRow());
    await executeTool("get_procurement", { sourceId: SOURCE_ID }, CTX);

    expect(fetchProcurementDetail).toHaveBeenCalledWith(SOURCE_ID);
    expect(fetchItems).toHaveBeenCalledWith(123);
    expect(fetchDocuments).toHaveBeenCalledWith(123);
    expect(fetchEnrichment).toHaveBeenCalledWith(123);
  });

  it("caps items at 20, truncates descriptions and keeps documents minimal", async () => {
    mock(fetchProcurementDetail).mockResolvedValue(detailRow());
    mock(fetchItems).mockResolvedValue(
      Array.from({ length: 25 }, (_, i) => ({
        item_number: i + 1,
        description: "x".repeat(400),
        kind: "material",
        quantity: "10",
        unit: "UN",
        estimated_unit_price: "1.00",
        estimated_total: "10.00",
        status_name: "Em andamento",
        benefit_type_name: null,
      })),
    );
    mock(fetchDocuments).mockResolvedValue([
      {
        sequence: 1,
        title: "Edital",
        type_id: 2,
        type_name: "Edital",
        url: "https://exemplo.gov.br/edital.pdf",
      },
    ]);
    mock(fetchEnrichment).mockResolvedValue({
      summary: "Compra de material escolar",
      categories: ["material de escritório"],
      concepts: ["lápis"],
      keywords: ["lapis"],
      requirements: [{ kind: "certification", description: "CNDs válidas" }],
      risks: ["prazo curto"],
      delivery_location: "Almoxarifado central",
      delivery_deadline_days: 15,
      me_epp_exclusive: true,
    });

    const res = await executeTool(
      "get_procurement",
      { sourceId: SOURCE_ID },
      CTX,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const data = res.data as {
      items: { description: string }[];
      items_total: number;
      documents: Record<string, unknown>[];
      enrichment: Record<string, unknown>;
    };
    expect(data.items_total).toBe(25);
    expect(data.items).toHaveLength(20);
    expect(data.items[0].description).toHaveLength(160);
    expect(data.documents[0]).toEqual({
      title: "Edital",
      url: "https://exemplo.gov.br/edital.pdf",
    });
    expect(data.enrichment.me_epp_exclusive).toBe(true);
    expect(data.enrichment).not.toHaveProperty("keywords");
    expect(res.refs).toHaveLength(1);
    expect(res.refs[0].source_id).toBe(SOURCE_ID);
  });
});

describe("calculate_match", () => {
  it("scores the requested sourceIds for ctx.companyId across all statuses", async () => {
    mock(fetchMatches).mockResolvedValue([matchRow()]);

    const res = await executeTool(
      "calculate_match",
      { sourceIds: [SOURCE_ID, OTHER] },
      CTX,
    );

    const [companyId, filters, limit] = mock(fetchMatches).mock.calls[0];
    expect(companyId).toBe(7);
    expect(filters).toEqual({
      sourceIds: [SOURCE_ID, OTHER],
      statuses: ["open", "upcoming", "closed"],
    });
    expect(limit).toBe(2);

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data).toEqual({
      matches: [
        {
          source_id: SOURCE_ID,
          score: 72,
          reasons: [{ code: "cnae_primary", weight: 35, detail: "4761-0/03" }],
          found: true,
        },
        { source_id: OTHER, score: null, reasons: [], found: false },
      ],
    });
    expect(res.refs[0].score).toBe(72);
  });

  it("rejects an empty or malformed list", async () => {
    expect(await executeTool("calculate_match", { sourceIds: [] }, CTX)).toEqual({
      ok: false,
      error: "número de controle inválido",
    });
    expect(
      await executeTool("calculate_match", { sourceIds: [SOURCE_ID, "x"] }, CTX),
    ).toEqual({ ok: false, error: "número de controle inválido" });
    expect(fetchMatches).not.toHaveBeenCalled();
  });
});

describe("analyze_procurement", () => {
  it("composes detail, items, enrichment, match and profile into one ref with score", async () => {
    mock(fetchProcurementDetail).mockResolvedValue(detailRow());
    mock(fetchItems).mockResolvedValue([
      {
        item_number: 1,
        description: "Lápis preto",
        kind: "material",
        quantity: "100",
        unit: "UN",
        estimated_unit_price: "1.00",
        estimated_total: "100.00",
        status_name: null,
        benefit_type_name: null,
      },
    ]);
    mock(fetchEnrichment).mockResolvedValue({
      summary: "Compra de material escolar",
      categories: ["material de escritório"],
      requirements: [{ kind: "certification", description: "CNDs válidas" }],
      risks: ["prazo curto"],
      delivery_location: "Almoxarifado",
      delivery_deadline_days: 15,
      me_epp_exclusive: false,
    });
    mock(fetchMatches).mockResolvedValue([matchRow()]);
    mock(getProfile).mockResolvedValue({
      terms: ["lapis"],
      exclusion_terms: ["obra"],
      states: ["RJ"],
      min_value: "1000",
      max_value: "50000",
    });

    const res = await executeTool(
      "analyze_procurement",
      { sourceId: SOURCE_ID },
      CTX,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const data = res.data as {
      procurement: Record<string, unknown>;
      items: unknown[];
      enrichment: Record<string, unknown>;
      match: { score: number; reasons: unknown[] };
      company: Record<string, unknown>;
    };
    expect(data.procurement.source_id).toBe(SOURCE_ID);
    expect(data.items).toHaveLength(1);
    expect(data.enrichment.summary).toBe("Compra de material escolar");
    expect(data.match).toEqual({
      score: 72,
      reasons: [{ code: "cnae_primary", weight: 35, detail: "4761-0/03" }],
    });
    expect(data.company).toEqual({
      name: "Alfa Ltda",
      size: "ME",
      terms: ["lapis"],
      exclusions: ["obra"],
      states: ["RJ"],
      min_value: "1000",
      max_value: "50000",
    });

    expect(mock(fetchMatches).mock.calls[0][0]).toBe(7);
    expect(res.refs).toHaveLength(1);
    expect(res.refs[0].score).toBe(72);
    expect(res.refs[0].status).toBe("open");
  });

  it("still answers when the procurement is not a candidate for this company", async () => {
    mock(fetchProcurementDetail).mockResolvedValue(detailRow());
    mock(fetchMatches).mockResolvedValue([]);

    const res = await executeTool(
      "analyze_procurement",
      { sourceId: SOURCE_ID },
      CTX,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect((res.data as { match: unknown }).match).toBeNull();
    expect(res.refs[0].score).toBeUndefined();
  });
});

describe("list_opportunities", () => {
  it("defaults to the attention view, scoped to ctx.companyId", async () => {
    mock(listOpportunities).mockResolvedValue([opportunityRow()]);

    const res = await executeTool("list_opportunities", {}, CTX);

    const [companyId, opts] = mock(listOpportunities).mock.calls[0];
    expect(companyId).toBe(7);
    expect(opts).toEqual({
      limit: 10,
      states: ["matched", "recommended"],
      minScore: 70,
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data).toEqual({
      total: 1,
      items: [
        {
          source_id: SOURCE_ID,
          score: 82,
          verdict: null,
          closes_at: CLOSES_AT.toISOString(),
          description: "Aquisição de lápis preto nº 2",
        },
      ],
    });
    expect(res.refs).toHaveLength(1);
    expect(res.refs[0]).toMatchObject({
      source_id: SOURCE_ID,
      score: 82,
      reasons: [{ code: "cnae_primary", weight: 35, detail: "4761-0/03" }],
    });
  });

  it("maps view=all and view=dismissed to different query options", async () => {
    await executeTool("list_opportunities", { view: "all" }, CTX);
    expect(mock(listOpportunities).mock.calls[0][1]).toEqual({ limit: 10 });

    await executeTool("list_opportunities", { view: "dismissed", limit: 3 }, CTX);
    expect(mock(listOpportunities).mock.calls[1][1]).toEqual({
      limit: 3,
      states: ["dismissed"],
    });
  });

  it("falls back to attention for an unknown view and clamps the limit", async () => {
    await executeTool("list_opportunities", { view: "bogus", limit: 500 }, CTX);
    expect(mock(listOpportunities).mock.calls[0][1]).toEqual({
      limit: 20,
      states: ["matched", "recommended"],
      minScore: 70,
    });
  });

  it("returns a short error when the query fails", async () => {
    mock(listOpportunities).mockRejectedValue(new Error("connection refused"));
    expect(await executeTool("list_opportunities", {}, CTX)).toEqual({
      ok: false,
      error: "falha ao consultar",
    });
  });
});

describe("explain_opportunity", () => {
  it("rejects a malformed source_id without touching the database", async () => {
    expect(
      await executeTool("explain_opportunity", { source_id: "123" }, CTX),
    ).toEqual({ ok: false, error: "número de controle inválido" });
    expect(await executeTool("explain_opportunity", {}, CTX)).toEqual({
      ok: false,
      error: "número de controle inválido",
    });
    expect(getOpportunity).not.toHaveBeenCalled();
  });

  it("reports a missing opportunity, scoped to ctx.companyId", async () => {
    mock(getOpportunity).mockResolvedValue(null);
    expect(
      await executeTool(
        "explain_opportunity",
        { source_id: SOURCE_ID, companyId: 999 },
        CTX,
      ),
    ).toEqual({ ok: false, error: "oportunidade não encontrada" });
    expect(getOpportunity).toHaveBeenCalledWith(7, SOURCE_ID);
  });

  it("returns score, reasons, verdict/rationale and state, plus one ref", async () => {
    mock(getOpportunity).mockResolvedValue(
      opportunityRow({ verdict: "go", rationale: "Atende os requisitos." }),
    );

    const res = await executeTool(
      "explain_opportunity",
      { source_id: SOURCE_ID },
      CTX,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.data).toEqual({
      score: 82,
      reasons: [{ code: "cnae_primary", detail: "4761-0/03" }],
      verdict: "go",
      rationale: "Atende os requisitos.",
      state: "matched",
    });
    expect(res.refs).toEqual([
      expect.objectContaining({ source_id: SOURCE_ID, score: 82 }),
    ]);
  });

  it("falls back to 'sem recomendação ainda' when there is no rationale yet", async () => {
    mock(getOpportunity).mockResolvedValue(opportunityRow());

    const res = await executeTool(
      "explain_opportunity",
      { source_id: SOURCE_ID },
      CTX,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect((res.data as { rationale: string }).rationale).toBe(
      "sem recomendação ainda",
    );
    expect((res.data as { verdict: unknown }).verdict).toBeNull();
  });
});

describe("executeTool", () => {
  it("rejects an unknown tool name", async () => {
    expect(await executeTool("prepare_participation", {}, CTX)).toEqual({
      ok: false,
      error: "ferramenta desconhecida",
    });
  });

  it("survives non-object arguments", async () => {
    const res = await executeTool("search_procurements", "lápis", CTX);
    expect(res.ok).toBe(true);
    expect(mock(fetchProcurements).mock.calls[0][0]).toEqual({
      statuses: ["open"],
    });
  });
});
