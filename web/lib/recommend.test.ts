import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Relative imports (not "@/lib/...") on purpose: vitest runs without a config
// file. Everything the batch talks to is mocked: no live database, no network.
vi.mock("./db", () => ({ pool: { query: vi.fn() } }));
vi.mock("./agent/llm", () => ({ getChatClient: vi.fn() }));
vi.mock("./company-queries", () => ({
  getCompany: vi.fn(),
  getCompanyCnaes: vi.fn(),
}));
vi.mock("./profile-queries", () => ({ getProfile: vi.fn() }));
vi.mock("./document-queries", () => ({ listDocuments: vi.fn() }));
vi.mock("./enrichment-queries", async () => {
  const actual =
    await vi.importActual<typeof import("./enrichment-queries")>(
      "./enrichment-queries",
    );
  return {
    REQUIREMENT_KIND_LABELS: actual.REQUIREMENT_KIND_LABELS,
    fetchEnrichment: vi.fn(),
  };
});
vi.mock("./opportunity-queries", async () => {
  const actual =
    await vi.importActual<typeof import("./opportunity-queries")>(
      "./opportunity-queries",
    );
  return {
    ATTENTION_SCORE: actual.ATTENTION_SCORE,
    setOpportunityState: vi.fn(),
  };
});
vi.mock("./recommendation-queries", () => ({
  countRecommendationsToday: vi.fn(),
  insertRecommendation: vi.fn(),
  listCandidatesForRecommendation: vi.fn(),
  listCompaniesWithCandidates: vi.fn(),
}));

import type OpenAI from "openai";

import { getCompany, getCompanyCnaes } from "./company-queries";
import { pool } from "./db";
import { listDocuments } from "./document-queries";
import { fetchEnrichment } from "./enrichment-queries";
import { setOpportunityState } from "./opportunity-queries";
import { getProfile } from "./profile-queries";
import {
  countRecommendationsToday,
  insertRecommendation,
  listCandidatesForRecommendation,
  listCompaniesWithCandidates,
} from "./recommendation-queries";
import {
  RECOMMEND_DAILY_CAP,
  buildRecommendationPrompt,
  parseRecommendation,
  runRecommendBatch,
} from "./recommend";

const query = pool.query as unknown as ReturnType<typeof vi.fn>;
const mock = (fn: unknown) => fn as unknown as ReturnType<typeof vi.fn>;

function candidate(over: Record<string, unknown> = {}) {
  return {
    opportunityId: 10,
    procurementId: 77,
    sourceId: "12345678000199-1-000001/2026",
    score: 85,
    reasons: [{ code: "term_enrichment", weight: 25, detail: "lapis" }],
    description: "Aquisição de lápis de cor",
    agency_name: "Prefeitura de Niterói",
    state_uf: "RJ",
    city_name: "Niterói",
    modality_name: "Pregão eletrônico",
    estimated_value: "12000.00",
    proposal_closes_at: new Date("2026-09-30T12:00:00Z"),
    ...over,
  } as never;
}

function enrichment(over: Record<string, unknown> = {}) {
  return {
    procurement_id: 77,
    input_kind: "edital",
    summary: "Compra de material escolar",
    categories: [],
    concepts: [],
    keywords: [],
    requirements: [
      {
        kind: "technical_qualification",
        description: "Atestado de fornecimento de material escolar",
      },
      { kind: "tax_compliance", description: "Certidão negativa federal" },
    ],
    risks: ["Prazo de entrega curto"],
    complexity: "low",
    requires_certification: false,
    requires_technical_certificate: true,
    me_epp_exclusive: true,
    me_epp_preference: null,
    delivery_location: "Almoxarifado central",
    delivery_deadline_days: 15,
    confidence: 0.9,
    model: "gpt-5-mini",
    enriched_at: new Date("2026-08-20T10:00:00Z"),
    ...over,
  } as never;
}

/** One `chat.completions.create` reply, scripted per call. */
function fakeClient(...contents: (string | Error)[]) {
  const create = vi.fn();
  for (const c of contents) {
    if (c instanceof Error) create.mockRejectedValueOnce(c);
    else create.mockResolvedValueOnce({ choices: [{ message: { content: c } }] });
  }
  return {
    client: { chat: { completions: { create } } } as unknown as OpenAI,
    create,
  };
}

/** The pool only ever sees the agent_runs open/close. */
function mockPool() {
  query.mockImplementation(async (text: string) => {
    if (text.includes("INSERT INTO agent_runs")) return { rows: [{ id: "42" }] };
    if (text.includes("UPDATE agent_runs")) return { rows: [] };
    throw new Error(`unexpected query: ${text}`);
  });
}

/** [text, values] of the run-closing UPDATE. */
function finishCall(): [string, unknown[]] {
  const call = query.mock.calls.find((c: unknown[]) =>
    String(c[0]).includes("UPDATE agent_runs"),
  ) as [string, unknown[]];
  return call;
}

const GO_JSON = JSON.stringify({
  verdict: "go",
  rationale: "Atende às exigências; empresa é ME e o certame é exclusivo ME/EPP.",
  confidence: 0.82,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  mockPool();
  mock(listCompaniesWithCandidates).mockResolvedValue([7]);
  mock(countRecommendationsToday).mockResolvedValue(0);
  mock(listCandidatesForRecommendation).mockResolvedValue([candidate()]);
  mock(fetchEnrichment).mockResolvedValue(enrichment());
  mock(getCompany).mockResolvedValue({
    id: 7,
    legal_name: "Alfa Comércio Ltda",
    size: "ME",
    state: "RJ",
  });
  mock(getCompanyCnaes).mockResolvedValue([
    { cnae_code: "4761003", description: "Comércio de artigos de papelaria", is_primary: true },
  ]);
  mock(getProfile).mockResolvedValue({
    products: ["lápis de cor"],
    keywords: ["material escolar"],
    exclusions: ["obras"],
    states: ["RJ"],
    min_value: "1000.00",
    max_value: "50000.00",
    notes: null,
  });
  mock(listDocuments).mockResolvedValue([
    { kind: "cnpj_card" },
    { kind: "technical_capacity_certificate" },
    { kind: "cnpj_card" },
  ]);
  mock(insertRecommendation).mockResolvedValue(undefined);
  mock(setOpportunityState).mockResolvedValue(undefined);
  vi.stubEnv("LIXTO_LLM_API_KEY", "test-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("buildRecommendationPrompt", () => {
  it("carries the requirement descriptions, the CNAEs and the document kinds", () => {
    const { system, user } = buildRecommendationPrompt({
      candidate: candidate(),
      enrichment: enrichment(),
      company: {
        id: 7,
        legal_name: "Alfa Comércio Ltda",
        size: "ME",
        state: "RJ",
      } as never,
      cnaes: [
        {
          cnae_code: "4761003",
          description: "Comércio de artigos de papelaria",
          is_primary: true,
        },
      ] as never,
      profile: {
        products: ["lápis de cor"],
        keywords: ["material escolar"],
        exclusions: ["obras"],
        states: ["RJ"],
        min_value: "1000.00",
        max_value: "50000.00",
        notes: null,
      } as never,
      documentKinds: ["cnpj_card", "technical_capacity_certificate"],
    });

    expect(system).toContain("GO / NO_GO / BORDERLINE");
    // Requirements, with their pt-BR kind labels.
    expect(user).toContain("Atestado de fornecimento de material escolar");
    expect(user).toContain("Certidão negativa federal");
    expect(user).toContain("Qualificação técnica");
    // Company side.
    expect(user).toContain("4761003");
    expect(user).toContain("lápis de cor");
    expect(user).toContain("Atestado de capacidade técnica");
    // Procurement + match facts.
    expect(user).toContain("Aquisição de lápis de cor");
    expect(user).toContain("Prefeitura de Niterói");
    expect(user).toContain("Score: 85");
    expect(user).toContain("term_enrichment");
  });

  it("still builds a prompt when the procurement has no enrichment", () => {
    const { user } = buildRecommendationPrompt({
      candidate: candidate(),
      enrichment: null,
      company: null,
      cnaes: [],
      profile: null,
      documentKinds: [],
    });
    expect(user).toContain("edital ainda não analisado");
    expect(user).toContain("12345678000199-1-000001/2026");
  });
});

describe("parseRecommendation", () => {
  it("parses plain JSON", () => {
    expect(parseRecommendation(GO_JSON)).toEqual({
      verdict: "go",
      rationale:
        "Atende às exigências; empresa é ME e o certame é exclusivo ME/EPP.",
      confidence: 0.82,
    });
  });

  it("tolerates code fences and surrounding prose", () => {
    const text = `Segue a análise:\n\`\`\`json\n{"verdict":"NO-GO","rationale":"Exige atestado que a empresa não possui.","confidence":"0.9"}\n\`\`\``;
    expect(parseRecommendation(text)).toEqual({
      verdict: "no_go",
      rationale: "Exige atestado que a empresa não possui.",
      confidence: 0.9,
    });
  });

  it("clamps the confidence and truncates the rationale at 600 chars", () => {
    const out = parseRecommendation(
      JSON.stringify({
        verdict: "borderline",
        rationale: "a".repeat(900),
        confidence: 7,
      }),
    );
    expect(out?.confidence).toBe(1);
    expect(out?.rationale).toHaveLength(600);
  });

  it("returns null for invalid JSON, unknown verdicts and empty rationales", () => {
    expect(parseRecommendation("não sei dizer")).toBeNull();
    expect(parseRecommendation("{ verdict: go }")).toBeNull();
    expect(
      parseRecommendation(JSON.stringify({ verdict: "talvez", rationale: "x" })),
    ).toBeNull();
    expect(
      parseRecommendation(JSON.stringify({ verdict: "go", rationale: "  " })),
    ).toBeNull();
    expect(parseRecommendation("")).toBeNull();
  });
});

describe("runRecommendBatch", () => {
  it("persists the verdict and moves the opportunity to recommended", async () => {
    const { client, create } = fakeClient(GO_JSON);

    const result = await runRecommendBatch({ deps: { client } });

    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0]).toMatchObject({
      response_format: { type: "json_object" },
    });
    expect(insertRecommendation).toHaveBeenCalledWith(10, {
      verdict: "go",
      rationale:
        "Atende às exigências; empresa é ME e o certame é exclusivo ME/EPP.",
      model: expect.any(String),
      confidence: 0.82,
    });
    expect(setOpportunityState).toHaveBeenCalledWith(7, 10, "recommended");
    expect(result).toMatchObject({
      runId: 42,
      companies: 1,
      recommended: 1,
      skipped_cap: 0,
      failed: 0,
    });
    expect(finishCall()[1][1]).toBe("done");
  });

  it("respects the daily cap: 4 already today leaves room for one call", async () => {
    mock(countRecommendationsToday).mockResolvedValue(4);
    const { client, create } = fakeClient(GO_JSON);

    await runRecommendBatch({ deps: { client }, limit: 5 });

    expect(listCandidatesForRecommendation).toHaveBeenCalledWith(7, 1);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("skips a company whose cap is already spent", async () => {
    mock(countRecommendationsToday).mockResolvedValue(RECOMMEND_DAILY_CAP);
    const { client, create } = fakeClient(GO_JSON);

    const result = await runRecommendBatch({ deps: { client } });

    expect(listCandidatesForRecommendation).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(result.skipped_cap).toBe(1);
    expect(result.recommended).toBe(0);
  });

  it("does not move the state when the reply cannot be parsed", async () => {
    const { client } = fakeClient("desculpe, não consegui analisar");

    const result = await runRecommendBatch({ deps: { client } });

    expect(insertRecommendation).not.toHaveBeenCalled();
    expect(setOpportunityState).not.toHaveBeenCalled();
    expect(result).toMatchObject({ recommended: 0, failed: 1 });
  });

  it("keeps going when one opportunity throws", async () => {
    mock(listCandidatesForRecommendation).mockResolvedValue([
      candidate({ opportunityId: 10 }),
      candidate({ opportunityId: 11 }),
    ]);
    const { client } = fakeClient(new Error("timeout"), GO_JSON);

    const result = await runRecommendBatch({ deps: { client } });

    expect(result).toMatchObject({ recommended: 1, failed: 1 });
    expect(setOpportunityState).toHaveBeenCalledWith(7, 11, "recommended");
  });

  it("without an API key counts every candidate as failed and records why", async () => {
    vi.stubEnv("LIXTO_LLM_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "");
    mock(listCandidatesForRecommendation).mockResolvedValue([
      candidate({ opportunityId: 10 }),
      candidate({ opportunityId: 11 }),
    ]);

    const result = await runRecommendBatch();

    expect(result).toMatchObject({ recommended: 0, failed: 2 });
    expect(insertRecommendation).not.toHaveBeenCalled();
    const [, values] = finishCall();
    expect(values[1]).toBe("done");
    expect(String(values[3])).toContain("LIXTO_LLM_API_KEY");
  });

  it("runs a single company when asked, without listing the others", async () => {
    const { client } = fakeClient(GO_JSON);

    await runRecommendBatch({ companyId: 7, deps: { client } });

    expect(listCompaniesWithCandidates).not.toHaveBeenCalled();
    expect(countRecommendationsToday).toHaveBeenCalledWith(7);
    // The run row is scoped to the company.
    const insert = query.mock.calls.find((c: unknown[]) =>
      String(c[0]).includes("INSERT INTO agent_runs"),
    ) as [string, unknown[]];
    expect(insert[1]).toEqual([7]);
  });
});
