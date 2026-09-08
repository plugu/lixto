import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Relative imports (not "@/lib/...") on purpose: vitest runs without a config
// file. Everything analyzeOpportunity talks to is mocked: no live database,
// no network.
vi.mock("./agent/llm", () => ({ getChatClient: vi.fn() }));
vi.mock("./radar-detail-queries", () => ({ fetchRadarDetail: vi.fn() }));
vi.mock("./profile-queries", () => ({ getProfile: vi.fn() }));
vi.mock("./radar-analysis-queries", () => ({
  getAnalysis: vi.fn(),
  insertAnalysis: vi.fn(),
  countAnalysesToday: vi.fn(),
}));

import type OpenAI from "openai";

import { getChatClient } from "./agent/llm";
import { getProfile } from "./profile-queries";
import type { CompanyProfile } from "./profile-queries";
import {
  countAnalysesToday,
  getAnalysis,
  insertAnalysis,
} from "./radar-analysis-queries";
import { fetchRadarDetail } from "./radar-detail-queries";
import type { RadarDetail } from "./radar-detail-queries";
import {
  RADAR_ANALYSIS_DAILY_CAP,
  analyzeOpportunity,
  buildRadarAnalysisPrompt,
  parseRadarAnalysis,
} from "./radar-analysis";

const mock = (fn: unknown) => fn as unknown as ReturnType<typeof vi.fn>;

function detail(over: Partial<RadarDetail> = {}): RadarDetail {
  return {
    id: 171,
    title: "PRESTAÇÃO DE SERVIÇO DE LIMPEZA E CONSERVAÇÃO",
    state: "MG",
    city_name: "Uberaba",
    estimated_value: "219093.00",
    expected_date: new Date("2026-12-31"),
    plan_year: 2026,
    opportunity_score: 85,
    signals: [{ code: "pca_item", weight: 50, detail: "No PCA do órgão" }],
    match_score: 65,
    reasons: [{ code: "term_text", weight: 40, detail: "limpeza" }],
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
  } as RadarDetail;
}

const PROFILE: CompanyProfile = {
  company_id: 1,
  products: ["serviços de limpeza"],
  keywords: ["conservação predial"],
  exclusions: ["obras"],
  terms: ["limpeza"],
  exclusion_terms: ["obras"],
  states: ["MG"],
  min_value: "1000.00",
  max_value: "500000.00",
  notes: null,
  embedding_text: null,
};

const ANALYSIS_JSON = JSON.stringify({
  why_it_may_happen: "O item está no PCA do órgão e o plano foi atualizado recentemente.",
  company_fit: "Provável aderência: a empresa vende serviços de limpeza no estado do órgão.",
  preparation: ["Reunir documentação de habilitação", "Levantar preço de referência"],
});

/** One `chat.completions.create` reply. */
function fakeClient(content: string) {
  const create = vi.fn().mockResolvedValueOnce({
    choices: [{ message: { content } }],
  });
  return { client: { chat: { completions: { create } } } as unknown as OpenAI, create };
}

beforeEach(() => {
  vi.clearAllMocks();
  mock(fetchRadarDetail).mockResolvedValue(detail());
  mock(getProfile).mockResolvedValue(PROFILE);
  mock(getAnalysis).mockResolvedValue(null);
  mock(countAnalysesToday).mockResolvedValue(0);
  mock(insertAnalysis).mockImplementation(async (companyId, id, model, content) => ({
    content,
    model,
    created_at: new Date("2026-09-01T12:00:00Z"),
  }));
  vi.stubEnv("LIXTO_LLM_API_KEY", "test-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("buildRadarAnalysisPrompt", () => {
  it("carries the opportunity facts, signals, reasons and profile — no history/competition section", () => {
    const { system, user } = buildRadarAnalysisPrompt({
      opportunity: detail(),
      profile: PROFILE,
    });

    expect(system).toContain("não invente");
    expect(system.toLowerCase()).toContain("condicional");
    expect(user).toContain("PRESTAÇÃO DE SERVIÇO DE LIMPEZA E CONSERVAÇÃO");
    expect(user).toContain("IF Sudeste MG");
    expect(user).toContain("Campus Sete Lagoas");
    expect(user).toContain("MG");
    expect(user).toContain("2026");
    expect(user).toContain("No PCA do órgão");
    expect(user).toContain("termos do perfil");
    expect(user).toContain("serviços de limpeza");
    expect(user).toContain("conservação predial");
    expect(user).not.toContain("histórico do órgão anterior");
    expect(user).not.toContain("concorrentes anteriores");
  });

  it("still builds a prompt with no profile", () => {
    const { user } = buildRadarAnalysisPrompt({
      opportunity: detail(),
      profile: null,
    });
    expect(user).toContain("PRESTAÇÃO DE SERVIÇO");
  });
});

describe("parseRadarAnalysis", () => {
  it("parses plain JSON", () => {
    expect(parseRadarAnalysis(ANALYSIS_JSON)).toEqual({
      why_it_may_happen:
        "O item está no PCA do órgão e o plano foi atualizado recentemente.",
      company_fit:
        "Provável aderência: a empresa vende serviços de limpeza no estado do órgão.",
      preparation: [
        "Reunir documentação de habilitação",
        "Levantar preço de referência",
      ],
    });
  });

  it("tolerates code fences and surrounding prose", () => {
    const text = `Segue:\n\`\`\`json\n${ANALYSIS_JSON}\n\`\`\``;
    expect(parseRadarAnalysis(text)?.why_it_may_happen).toContain("PCA");
  });

  it("caps each string at 800 chars and preparation at 6 items", () => {
    const out = parseRadarAnalysis(
      JSON.stringify({
        why_it_may_happen: "a".repeat(900),
        company_fit: "b".repeat(900),
        preparation: Array.from({ length: 10 }, (_, i) => `passo ${i}`),
      }),
    );
    expect(out?.why_it_may_happen).toHaveLength(800);
    expect(out?.company_fit).toHaveLength(800);
    expect(out?.preparation).toHaveLength(6);
  });

  it("returns null for invalid JSON or missing required fields", () => {
    expect(parseRadarAnalysis("não sei dizer")).toBeNull();
    expect(parseRadarAnalysis("{ why_it_may_happen: x }")).toBeNull();
    expect(
      parseRadarAnalysis(JSON.stringify({ why_it_may_happen: "x" })),
    ).toBeNull();
    expect(parseRadarAnalysis("")).toBeNull();
  });
});

describe("analyzeOpportunity", () => {
  it("returns the cached row without calling the LLM", async () => {
    mock(getAnalysis).mockResolvedValue({
      content: {
        why_it_may_happen: "cached",
        company_fit: "cached",
        preparation: [],
      },
      model: "gemini-3.7-flash",
      created_at: new Date("2026-09-01"),
    });
    const { client, create } = fakeClient(ANALYSIS_JSON);

    const result = await analyzeOpportunity(1, 171, { client });

    expect(create).not.toHaveBeenCalled();
    expect(result).toMatchObject({ cached: true });
    if ("cached" in result) {
      expect(result.analysis.why_it_may_happen).toBe("cached");
    }
    expect(insertAnalysis).not.toHaveBeenCalled();
  });

  it("enforces the daily cap before calling the LLM", async () => {
    mock(countAnalysesToday).mockResolvedValue(RADAR_ANALYSIS_DAILY_CAP);
    const { client, create } = fakeClient(ANALYSIS_JSON);

    const result = await analyzeOpportunity(1, 171, { client });

    expect(create).not.toHaveBeenCalled();
    expect(result).toMatchObject({ error: expect.stringContaining("limite diário") });
  });

  it("calls the LLM once and persists the parsed result", async () => {
    const { client, create } = fakeClient(ANALYSIS_JSON);

    const result = await analyzeOpportunity(1, 171, { client });

    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0]).toMatchObject({
      response_format: { type: "json_object" },
    });
    expect(insertAnalysis).toHaveBeenCalledWith(
      1,
      171,
      expect.any(String),
      expect.objectContaining({ why_it_may_happen: expect.any(String) }),
    );
    expect(result).toMatchObject({ cached: false });
  });

  it("returns an error when the reply cannot be parsed", async () => {
    const { client } = fakeClient("desculpe, não consegui analisar");

    const result = await analyzeOpportunity(1, 171, { client });

    expect(insertAnalysis).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      error: expect.stringContaining("não foi possível gerar a análise"),
    });
  });

  it("without an API key and no injected client returns the missing-key error", async () => {
    vi.stubEnv("LIXTO_LLM_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "");

    const result = await analyzeOpportunity(1, 171);

    expect(getChatClient).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      error: expect.stringContaining("sem chave de API"),
    });
  });
});
