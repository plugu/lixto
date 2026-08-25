import { beforeEach, describe, expect, it, vi } from "vitest";

// Relative imports (not "@/lib/...") on purpose: vitest runs without a config
// file. Every query module is mocked — these tests never touch a database, and
// mocking them also keeps `db.ts` (and its pool) out of the module graph.
vi.mock("../queries", () => ({ fetchLicitacoes: vi.fn() }));
vi.mock("../match-queries", () => ({ fetchMatches: vi.fn() }));
vi.mock("../perfil-queries", () => ({ getPerfil: vi.fn() }));
vi.mock("../empresa-queries", () => ({ getCnaes: vi.fn() }));
vi.mock("../enriquecimento-queries", () => ({ fetchEnriquecimento: vi.fn() }));
vi.mock("../analise-queries", () => ({ fetchAnalise: vi.fn() }));
vi.mock("../detail-queries", () => ({
  fetchLicitacaoDetail: vi.fn(),
  fetchItens: vi.fn(),
  fetchDocumentos: vi.fn(),
}));

import { fetchAnalise } from "../analise-queries";
import { fetchDocumentos, fetchItens, fetchLicitacaoDetail } from "../detail-queries";
import { getCnaes } from "../empresa-queries";
import { fetchEnriquecimento } from "../enriquecimento-queries";
import { fetchMatches } from "../match-queries";
import { getPerfil } from "../perfil-queries";
import { fetchLicitacoes } from "../queries";
import {
  asIntArray,
  asNumber,
  asStringArray,
  asUf,
  executeTool,
  TOOL_DEFINITIONS,
} from "./tools";
import type { ToolContext } from "./types";

const mock = <T>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

const NUMERO = "12345678000199-1-000123/2026";
const OUTRO = "12345678000199-1-000124/2026";

const CTX: ToolContext = { empresaId: 7, porte: "ME", empresaNome: "Alfa Ltda" };

const ABERTURA = new Date("2026-01-01T12:00:00Z");
const ENCERRAMENTO = new Date("2999-01-01T12:00:00Z");

function licitacaoRow(over: Record<string, unknown> = {}) {
  return {
    numero_controle_pncp: NUMERO,
    objeto_compra: "Aquisição de lápis preto nº 2",
    orgao_razao_social: "Prefeitura do Rio de Janeiro",
    municipio_nome: "Rio de Janeiro",
    uf: "RJ",
    modalidade_nome: "Pregão Eletrônico",
    valor_total_estimado: "18400.00",
    data_abertura_proposta: ABERTURA,
    data_encerramento_proposta: ENCERRAMENTO,
    ...over,
  };
}

function matchRow(over: Record<string, unknown> = {}) {
  return {
    ...licitacaoRow(),
    resumo: null,
    riscos: null,
    complexidade: null,
    enriquecido: true,
    score: 72,
    motivos: [{ codigo: "cnae_principal", peso: 35, detalhe: "4761-0/03" }],
    ...over,
  };
}

function detailRow(over: Record<string, unknown> = {}) {
  return {
    ...licitacaoRow(),
    unidade_nome: "Secretaria de Educação",
    modo_disputa_nome: "Aberto",
    situacao_compra_nome: "Divulgada no PNCP",
    srp: false,
    link_sistema_origem: "https://exemplo.gov.br/1",
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  mock(fetchLicitacoes).mockResolvedValue({ rows: [], total: 0 });
  mock(fetchMatches).mockResolvedValue([]);
  mock(getPerfil).mockResolvedValue(null);
  mock(getCnaes).mockResolvedValue([{ codigo: "4761-0/03", principal: true }]);
  mock(fetchLicitacaoDetail).mockResolvedValue(null);
  mock(fetchItens).mockResolvedValue([]);
  mock(fetchDocumentos).mockResolvedValue([]);
  mock(fetchEnriquecimento).mockResolvedValue(null);
  mock(fetchAnalise).mockResolvedValue(null);
});

describe("TOOL_DEFINITIONS", () => {
  it("declares the five cycle-16 tools with object schemas", () => {
    expect(TOOL_DEFINITIONS.map((t) => t.name)).toEqual([
      "search_procurements",
      "search_my_matches",
      "get_procurement",
      "calculate_match",
      "analyze_procurement",
    ]);
    for (const tool of TOOL_DEFINITIONS) {
      expect(tool.parameters.type).toBe("object");
      expect(tool.description.length).toBeGreaterThan(20);
    }
  });

  it("never exposes an empresaId parameter to the model", () => {
    const json = JSON.stringify(TOOL_DEFINITIONS);
    expect(json).not.toContain("empresaId");
    expect(json).not.toContain("empresa_id");
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

  it("asUf uppercases known UFs and drops the rest", () => {
    expect(asUf("rj")).toBe("RJ");
    expect(asUf(" sp ")).toBe("SP");
    expect(asUf("XX")).toBeUndefined();
    expect(asUf(11)).toBeUndefined();
  });
});

describe("search_procurements", () => {
  it("defaults to abertas, normalizes UFs and returns refs with status", async () => {
    mock(fetchLicitacoes).mockResolvedValue({ rows: [licitacaoRow()], total: 1 });

    const res = await executeTool("search_procurements", { q: "lápis", ufs: ["rj"] }, CTX);

    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const [filters, limit, offset] = mock(fetchLicitacoes).mock.calls[0];
    expect(filters).toEqual({ q: "lápis", ufs: ["RJ"], statuses: ["aberta"] });
    expect(limit).toBe(10);
    expect(offset).toBe(0);

    expect(res.refs).toHaveLength(1);
    expect(res.refs[0]).toMatchObject({
      numero_controle_pncp: NUMERO,
      uf: "RJ",
      municipio: "Rio de Janeiro",
      modalidade: "Pregão Eletrônico",
      valor_estimado: "18400.00",
      status: "aberta",
    });
    expect(res.refs[0].encerramento).toBe(ENCERRAMENTO.toISOString());
    expect(res.data).toEqual({ total: 1, itens: res.refs });
  });

  it("clamps limit to 1..20 and drops invalid filter values", async () => {
    await executeTool(
      "search_procurements",
      { limit: 500, ufs: ["ZZ"], statuses: ["nope"], modalidadeIds: ["6", "x"] },
      CTX,
    );
    expect(mock(fetchLicitacoes).mock.calls[0][1]).toBe(20);
    expect(mock(fetchLicitacoes).mock.calls[0][0]).toEqual({
      statuses: ["aberta"],
      modalidadeIds: [6],
    });

    await executeTool("search_procurements", { limit: 0 }, CTX);
    expect(mock(fetchLicitacoes).mock.calls[1][1]).toBe(1);
  });

  it("honours explicit statuses and value bounds", async () => {
    await executeTool(
      "search_procurements",
      { statuses: ["fechada", "vai_abrir"], valorMin: "1000", valorMax: 5000 },
      CTX,
    );
    expect(mock(fetchLicitacoes).mock.calls[0][0]).toEqual({
      statuses: ["fechada", "vai_abrir"],
      valorMin: 1000,
      valorMax: 5000,
    });
  });

  it("returns a short error (not a stack trace) when the query fails", async () => {
    mock(fetchLicitacoes).mockRejectedValue(new Error("connection refused"));
    expect(await executeTool("search_procurements", {}, CTX)).toEqual({
      ok: false,
      erro: "falha ao consultar",
    });
  });
});

describe("search_my_matches", () => {
  it("uses ctx.empresaId, never one supplied in the arguments", async () => {
    mock(fetchMatches).mockResolvedValue([matchRow()]);

    const res = await executeTool(
      "search_my_matches",
      { q: "lápis", empresaId: 999, empresa_id: 999 },
      CTX,
    );

    const [empresaId, filters, limit] = mock(fetchMatches).mock.calls[0];
    expect(empresaId).toBe(7);
    expect(filters).toEqual({ q: "lápis", statuses: ["aberta", "vai_abrir"] });
    expect(limit).toBe(10);
    expect(JSON.stringify(filters)).not.toContain("999");

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.refs[0].score).toBe(72);
    expect(res.refs[0].motivos).toEqual([
      { codigo: "cnae_principal", peso: 35, detalhe: "4761-0/03" },
    ]);
  });

  it("returns the aviso when the empresa has no perfil and no CNAEs", async () => {
    mock(getPerfil).mockResolvedValue(null);
    mock(getCnaes).mockResolvedValue([]);

    expect(await executeTool("search_my_matches", {}, CTX)).toEqual({
      ok: true,
      data: { aviso: "perfil de match não configurado", url: "/empresa/perfil" },
      refs: [],
    });
    expect(fetchMatches).not.toHaveBeenCalled();
  });

  it("still matches on CNAEs alone when there is no perfil row", async () => {
    mock(getPerfil).mockResolvedValue(null);
    mock(fetchMatches).mockResolvedValue([matchRow()]);

    const res = await executeTool("search_my_matches", {}, CTX);
    expect(res.ok).toBe(true);
    expect(fetchMatches).toHaveBeenCalledTimes(1);
  });
});

describe("get_procurement", () => {
  it("rejects a malformed numero without touching the database", async () => {
    expect(await executeTool("get_procurement", { numero: "123" }, CTX)).toEqual({
      ok: false,
      erro: "número de controle inválido",
    });
    expect(await executeTool("get_procurement", {}, CTX)).toEqual({
      ok: false,
      erro: "número de controle inválido",
    });
    expect(fetchLicitacaoDetail).not.toHaveBeenCalled();
  });

  it("reports a missing licitação", async () => {
    mock(fetchLicitacaoDetail).mockResolvedValue(null);
    expect(await executeTool("get_procurement", { numero: NUMERO }, CTX)).toEqual({
      ok: false,
      erro: "licitação não encontrada",
    });
  });

  it("caps itens at 20, truncates descriptions and keeps documentos minimal", async () => {
    mock(fetchLicitacaoDetail).mockResolvedValue(detailRow());
    mock(fetchItens).mockResolvedValue(
      Array.from({ length: 25 }, (_, i) => ({
        numero_item: i + 1,
        descricao: "x".repeat(400),
        quantidade: "10",
        unidade_medida: "UN",
        valor_unitario_estimado: "1.00",
        valor_total: "10.00",
        situacao_compra_item_nome: "Em andamento",
        tipo_beneficio_nome: null,
      })),
    );
    mock(fetchDocumentos).mockResolvedValue([
      {
        sequencial_documento: 1,
        titulo: "Edital",
        tipo_documento_id: 2,
        tipo_documento_nome: "Edital",
        url: "https://exemplo.gov.br/edital.pdf",
      },
    ]);
    mock(fetchEnriquecimento).mockResolvedValue({
      resumo: "Compra de material escolar",
      categorias: ["material de escritório"],
      conceitos: ["lápis"],
      palavras_chave: ["lapis"],
      requisitos: [{ tipo: "habilitacao", descricao: "CNDs válidas" }],
      riscos: ["prazo curto"],
      entrega: { local: "Almoxarifado central", prazo_dias: 15 },
      me_epp_exclusivo: true,
    });
    mock(fetchAnalise).mockResolvedValue({ verdict: "fit", fit_score: 80, deep_verdict: null, reasoning: "ok" });

    const res = await executeTool("get_procurement", { numero: NUMERO }, CTX);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const data = res.data as {
      itens: { descricao: string }[];
      itens_total: number;
      documentos: Record<string, unknown>[];
      enriquecimento: Record<string, unknown>;
      analise: Record<string, unknown>;
    };
    expect(data.itens_total).toBe(25);
    expect(data.itens).toHaveLength(20);
    expect(data.itens[0].descricao).toHaveLength(160);
    expect(data.documentos[0]).toEqual({
      titulo: "Edital",
      url: "https://exemplo.gov.br/edital.pdf",
    });
    expect(data.enriquecimento.me_epp_exclusivo).toBe(true);
    expect(data.enriquecimento).not.toHaveProperty("palavras_chave");
    expect(data.analise.verdict).toBe("fit");
    expect(res.refs).toHaveLength(1);
    expect(res.refs[0].numero_controle_pncp).toBe(NUMERO);
  });
});

describe("calculate_match", () => {
  it("scores the requested numeros for ctx.empresaId across all statuses", async () => {
    mock(fetchMatches).mockResolvedValue([matchRow()]);

    const res = await executeTool(
      "calculate_match",
      { numeros: [NUMERO, OUTRO] },
      CTX,
    );

    const [empresaId, filters, limit] = mock(fetchMatches).mock.calls[0];
    expect(empresaId).toBe(7);
    expect(filters).toEqual({
      numeros: [NUMERO, OUTRO],
      statuses: ["aberta", "vai_abrir", "fechada"],
    });
    expect(limit).toBe(2);

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data).toEqual({
      matches: [
        {
          numero_controle_pncp: NUMERO,
          score: 72,
          motivos: [{ codigo: "cnae_principal", peso: 35, detalhe: "4761-0/03" }],
          encontrada: true,
        },
        { numero_controle_pncp: OUTRO, score: null, motivos: [], encontrada: false },
      ],
    });
    expect(res.refs[0].score).toBe(72);
  });

  it("rejects an empty or malformed list", async () => {
    expect(await executeTool("calculate_match", { numeros: [] }, CTX)).toEqual({
      ok: false,
      erro: "número de controle inválido",
    });
    expect(await executeTool("calculate_match", { numeros: [NUMERO, "x"] }, CTX)).toEqual({
      ok: false,
      erro: "número de controle inválido",
    });
    expect(fetchMatches).not.toHaveBeenCalled();
  });
});

describe("analyze_procurement", () => {
  it("composes detail, itens, enriquecimento, match and perfil into one ref with score", async () => {
    mock(fetchLicitacaoDetail).mockResolvedValue(detailRow());
    mock(fetchItens).mockResolvedValue([
      {
        numero_item: 1,
        descricao: "Lápis preto",
        quantidade: "100",
        unidade_medida: "UN",
        valor_unitario_estimado: "1.00",
        valor_total: "100.00",
        situacao_compra_item_nome: null,
        tipo_beneficio_nome: null,
      },
    ]);
    mock(fetchEnriquecimento).mockResolvedValue({
      resumo: "Compra de material escolar",
      categorias: ["material de escritório"],
      requisitos: [{ tipo: "habilitacao", descricao: "CNDs válidas" }],
      riscos: ["prazo curto"],
      entrega: { local: "Almoxarifado", prazo_dias: 15 },
      me_epp_exclusivo: false,
    });
    mock(fetchMatches).mockResolvedValue([matchRow()]);
    mock(getPerfil).mockResolvedValue({
      termos: ["lapis"],
      exclusoes_termos: ["obra"],
      ufs: ["RJ"],
      valor_min: "1000",
      valor_max: "50000",
    });

    const res = await executeTool("analyze_procurement", { numero: NUMERO }, CTX);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const data = res.data as {
      licitacao: Record<string, unknown>;
      itens: unknown[];
      enriquecimento: Record<string, unknown>;
      match: { score: number; motivos: unknown[] };
      empresa: Record<string, unknown>;
    };
    expect(data.licitacao.numero_controle_pncp).toBe(NUMERO);
    expect(data.itens).toHaveLength(1);
    expect(data.enriquecimento.resumo).toBe("Compra de material escolar");
    expect(data.match).toEqual({
      score: 72,
      motivos: [{ codigo: "cnae_principal", peso: 35, detalhe: "4761-0/03" }],
    });
    expect(data.empresa).toEqual({
      nome: "Alfa Ltda",
      porte: "ME",
      termos: ["lapis"],
      exclusoes: ["obra"],
      ufs: ["RJ"],
      valor_min: "1000",
      valor_max: "50000",
    });

    expect(mock(fetchMatches).mock.calls[0][0]).toBe(7);
    expect(res.refs).toHaveLength(1);
    expect(res.refs[0].score).toBe(72);
    expect(res.refs[0].status).toBe("aberta");
  });

  it("still answers when the licitação is not a candidate for this empresa", async () => {
    mock(fetchLicitacaoDetail).mockResolvedValue(detailRow());
    mock(fetchMatches).mockResolvedValue([]);

    const res = await executeTool("analyze_procurement", { numero: NUMERO }, CTX);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect((res.data as { match: unknown }).match).toBeNull();
    expect(res.refs[0].score).toBeUndefined();
  });
});

describe("executeTool", () => {
  it("rejects an unknown tool name", async () => {
    expect(await executeTool("prepare_participation", {}, CTX)).toEqual({
      ok: false,
      erro: "ferramenta desconhecida",
    });
  });

  it("survives non-object arguments", async () => {
    const res = await executeTool("search_procurements", "lápis", CTX);
    expect(res.ok).toBe(true);
    expect(mock(fetchLicitacoes).mock.calls[0][0]).toEqual({ statuses: ["aberta"] });
  });
});
