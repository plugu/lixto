// The safe tool layer the chat model calls (ticket 67).
//
// Rules this file exists to enforce:
//  1. The model never writes SQL. It emits a tool name + JSON arguments; every
//     tool maps them onto an existing query builder with bound parameters.
//  2. `empresaId` comes from `ToolContext` (i.e. the session) only. No tool
//     accepts, reads or forwards an empresa id from the model's arguments.
//  3. Arguments are validated by hand, `parseFilters`-style: unknown or
//     invalid values are dropped, never thrown back at the model as a stack
//     trace. Query failures become a short PT-BR `erro` string; the real error
//     goes to `console.error` for us.
//  4. `data` stays small (no `raw` blobs, itens capped, texts truncated) —
//     every field here is billed as prompt tokens on the next turn.

import { fetchAnalise } from "../analise-queries";
import { fetchDocumentos, fetchItens, fetchLicitacaoDetail } from "../detail-queries";
import { fetchEnriquecimento } from "../enriquecimento-queries";
import { getCnaes } from "../empresa-queries";
import type { Motivo } from "../match-engine";
import { fetchMatches, type MatchFilters, type MatchRow } from "../match-queries";
import { getPerfil } from "../perfil-queries";
import { fetchLicitacoes, type LicitacaoFilters } from "../queries";
import { computeStatus, type StatusLicitacao } from "../status";
import { UF_LIST } from "../tenant-types";
import type { LicitacaoRef, ToolContext, ToolDefinition, ToolResult } from "./types";

/** PNCP control number: `<cnpj14>-<digito>-<sequencial6>/<ano>`. */
const NUMERO_RE = /^\d{14}-\d-\d{6}\/\d{4}$/;

const STATUSES: StatusLicitacao[] = ["aberta", "vai_abrir", "fechada"];

/** How much free text ever reaches the model per field. */
const MAX_TEXTO = 160;
const MAX_ITENS = 20;
const MAX_DOCUMENTOS = 10;
const MAX_LIMIT = 20;
const DEFAULT_LIMIT = 10;
const MAX_NUMEROS = 10;

// ---------------------------------------------------------------------------
// Argument coercion (exported for tests)
// ---------------------------------------------------------------------------

/** Non-empty trimmed strings from an array; anything else → []. */
export function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

/** Integers from an array (numeric strings accepted); anything else → []. */
export function asIntArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const out: number[] = [];
  for (const v of value) {
    const n = typeof v === "string" ? Number.parseInt(v.trim(), 10) : v;
    if (typeof n === "number" && Number.isInteger(n)) out.push(n);
  }
  return out;
}

/** A finite number (numeric strings accepted); anything else → undefined. */
export function asNumber(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string" && value.trim().length > 0) {
    const n = Number(value.trim());
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/** A known UF, uppercased ("rj" → "RJ"); anything else → undefined. */
export function asUf(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const uf = value.trim().toUpperCase();
  return UF_LIST.includes(uf) ? uf : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asStatuses(value: unknown): StatusLicitacao[] {
  return asStringArray(value).filter((v): v is StatusLicitacao =>
    (STATUSES as string[]).includes(v),
  );
}

function asLimit(value: unknown): number {
  const n = asNumber(value);
  if (n === undefined) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.trunc(n)));
}

function truncate(text: string | null, max = MAX_TEXTO): string | null {
  if (text === null) return null;
  const trimmed = text.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}

function iso(data: Date | string | null): string | null {
  if (data === null) return null;
  const date = typeof data === "string" ? new Date(data) : data;
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** The search args shared by `search_procurements` and `search_my_matches`.
 * `statuses` falls back to the caller-supplied default. */
function parseBuscaArgs(
  args: unknown,
  statusPadrao: StatusLicitacao[],
): { filters: MatchFilters & LicitacaoFilters; limit: number } {
  const raw = asRecord(args);
  const filters: MatchFilters & LicitacaoFilters = {};

  const q = asString(raw.q);
  if (q) filters.q = q;

  const ufs = asStringArray(raw.ufs)
    .map(asUf)
    .filter((uf): uf is string => uf !== undefined);
  if (ufs.length > 0) filters.ufs = ufs;

  const statuses = asStatuses(raw.statuses);
  filters.statuses = statuses.length > 0 ? statuses : statusPadrao;

  const modalidadeIds = asIntArray(raw.modalidadeIds);
  if (modalidadeIds.length > 0) filters.modalidadeIds = modalidadeIds;

  const valorMin = asNumber(raw.valorMin);
  if (valorMin !== undefined) filters.valorMin = valorMin;

  const valorMax = asNumber(raw.valorMax);
  if (valorMax !== undefined) filters.valorMax = valorMax;

  return { filters, limit: asLimit(raw.limit) };
}

// ---------------------------------------------------------------------------
// Row → card shapes
// ---------------------------------------------------------------------------

type RefSource = {
  numero_controle_pncp: string;
  objeto_compra: string | null;
  orgao_razao_social: string | null;
  uf: string | null;
  municipio_nome: string | null;
  modalidade_nome: string | null;
  valor_total_estimado: string | null;
  data_abertura_proposta: Date | null;
  data_encerramento_proposta: Date | null;
};

function toRef(
  row: RefSource,
  extra?: { score: number; motivos: Motivo[] },
): LicitacaoRef {
  return {
    numero_controle_pncp: row.numero_controle_pncp,
    objeto: truncate(row.objeto_compra),
    orgao: row.orgao_razao_social,
    uf: row.uf,
    municipio: row.municipio_nome,
    modalidade: row.modalidade_nome,
    valor_estimado: row.valor_total_estimado,
    encerramento: iso(row.data_encerramento_proposta),
    status: computeStatus(row.data_abertura_proposta, row.data_encerramento_proposta),
    ...(extra ?? {}),
  };
}

function matchRefs(rows: MatchRow[]): LicitacaoRef[] {
  return rows.map((row) => toRef(row, { score: row.score, motivos: row.motivos }));
}

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

const ERRO_NUMERO = "número de controle inválido";

async function searchProcurements(args: unknown): Promise<ToolResult> {
  const { filters, limit } = parseBuscaArgs(args, ["aberta"]);
  const { rows, total } = await fetchLicitacoes(filters, limit, 0);
  const refs = rows.map((row) => toRef(row));
  return { ok: true, data: { total, itens: refs }, refs };
}

/** True when the empresa has neither a match profile nor CNAEs — matching
 * would have nothing to score against, so we point the user at the form
 * instead of returning an empty list they can't interpret. */
async function semPerfilDeMatch(empresaId: number): Promise<boolean> {
  const [perfil, cnaes] = await Promise.all([getPerfil(empresaId), getCnaes(empresaId)]);
  return perfil === null && cnaes.length === 0;
}

async function searchMyMatches(args: unknown, ctx: ToolContext): Promise<ToolResult> {
  if (await semPerfilDeMatch(ctx.empresaId)) {
    return {
      ok: true,
      data: { aviso: "perfil de match não configurado", url: "/empresa/perfil" },
      refs: [],
    };
  }
  const { filters, limit } = parseBuscaArgs(args, ["aberta", "vai_abrir"]);
  const rows = await fetchMatches(ctx.empresaId, filters, limit);
  const refs = matchRefs(rows);
  return { ok: true, data: { total: refs.length, itens: refs }, refs };
}

/** Detail + itens + documentos + enriquecimento + analise for one licitação,
 * already trimmed to what the model needs. Returns null when the licitação
 * doesn't exist. Shared by `get_procurement` and `analyze_procurement`. */
async function dossie(numero: string) {
  const detail = await fetchLicitacaoDetail(numero);
  if (detail === null) return null;

  const [itens, documentos, enriquecimento, analise] = await Promise.all([
    fetchItens(numero),
    fetchDocumentos(numero),
    fetchEnriquecimento(numero),
    fetchAnalise(numero),
  ]);

  const data = {
    licitacao: {
      numero_controle_pncp: detail.numero_controle_pncp,
      objeto: detail.objeto_compra,
      orgao: detail.orgao_razao_social,
      unidade: detail.unidade_nome,
      uf: detail.uf,
      municipio: detail.municipio_nome,
      modalidade: detail.modalidade_nome,
      modo_disputa: detail.modo_disputa_nome,
      situacao: detail.situacao_compra_nome,
      srp: detail.srp,
      valor_estimado: detail.valor_total_estimado,
      abertura: iso(detail.data_abertura_proposta),
      encerramento: iso(detail.data_encerramento_proposta),
      status: computeStatus(
        detail.data_abertura_proposta,
        detail.data_encerramento_proposta,
      ),
      link: detail.link_sistema_origem,
    },
    itens_total: itens.length,
    itens: itens.slice(0, MAX_ITENS).map((item) => ({
      numero_item: item.numero_item,
      descricao: truncate(item.descricao),
      quantidade: item.quantidade,
      unidade: item.unidade_medida,
      valor_unitario_estimado: item.valor_unitario_estimado,
      valor_total: item.valor_total,
      beneficio: item.tipo_beneficio_nome,
    })),
    documentos: documentos.slice(0, MAX_DOCUMENTOS).map((doc) => ({
      titulo: doc.titulo,
      url: doc.url,
    })),
    enriquecimento: enriquecimento
      ? {
          resumo: enriquecimento.resumo,
          categorias: enriquecimento.categorias,
          requisitos: enriquecimento.requisitos,
          riscos: enriquecimento.riscos,
          entrega: enriquecimento.entrega,
          me_epp_exclusivo: enriquecimento.me_epp_exclusivo,
        }
      : null,
    analise: analise
      ? {
          verdict: analise.verdict,
          fit_score: analise.fit_score,
          deep_verdict: analise.deep_verdict,
          reasoning: truncate(analise.reasoning, 400),
        }
      : null,
  };

  return { detail, data };
}

async function getProcurement(args: unknown): Promise<ToolResult> {
  const numero = asString(asRecord(args).numero);
  if (!numero || !NUMERO_RE.test(numero)) return { ok: false, erro: ERRO_NUMERO };

  const found = await dossie(numero);
  if (found === null) return { ok: false, erro: "licitação não encontrada" };

  return { ok: true, data: found.data, refs: [toRef(found.detail)] };
}

/** Scores the given numeros for this empresa. All three statuses are allowed:
 * the user may ask about a licitação that has already closed. */
async function matchesFor(empresaId: number, numeros: string[]): Promise<MatchRow[]> {
  return fetchMatches(
    empresaId,
    { numeros, statuses: ["aberta", "vai_abrir", "fechada"] },
    numeros.length,
  );
}

async function calculateMatch(args: unknown, ctx: ToolContext): Promise<ToolResult> {
  const numeros = asStringArray(asRecord(args).numeros).slice(0, MAX_NUMEROS);
  if (numeros.length === 0 || !numeros.every((n) => NUMERO_RE.test(n))) {
    return { ok: false, erro: ERRO_NUMERO };
  }

  const rows = await matchesFor(ctx.empresaId, numeros);
  const porNumero = new Map(rows.map((row) => [row.numero_controle_pncp, row]));

  return {
    ok: true,
    data: {
      matches: numeros.map((numero) => {
        const row = porNumero.get(numero);
        return {
          numero_controle_pncp: numero,
          score: row?.score ?? null,
          motivos: row?.motivos ?? [],
          encontrada: row !== undefined,
        };
      }),
    },
    refs: matchRefs(rows),
  };
}

async function analyzeProcurement(args: unknown, ctx: ToolContext): Promise<ToolResult> {
  const numero = asString(asRecord(args).numero);
  if (!numero || !NUMERO_RE.test(numero)) return { ok: false, erro: ERRO_NUMERO };

  const found = await dossie(numero);
  if (found === null) return { ok: false, erro: "licitação não encontrada" };

  const [rows, perfil] = await Promise.all([
    matchesFor(ctx.empresaId, [numero]),
    getPerfil(ctx.empresaId),
  ]);
  const row = rows.find((r) => r.numero_controle_pncp === numero);

  const data = {
    ...found.data,
    match: row ? { score: row.score, motivos: row.motivos } : null,
    empresa: {
      nome: ctx.empresaNome,
      porte: ctx.porte,
      termos: perfil?.termos ?? [],
      exclusoes: perfil?.exclusoes_termos ?? [],
      ufs: perfil?.ufs ?? [],
      valor_min: perfil?.valor_min ?? null,
      valor_max: perfil?.valor_max ?? null,
    },
  };

  const ref = row
    ? toRef(found.detail, { score: row.score, motivos: row.motivos })
    : toRef(found.detail);

  return { ok: true, data, refs: [ref] };
}

// ---------------------------------------------------------------------------
// Declarations + dispatch
// ---------------------------------------------------------------------------

/** JSON Schema fragment shared by the two search tools. */
function buscaProperties(statusDefault: string): Record<string, unknown> {
  return {
    q: {
      type: "string",
      description:
        "Termo de busca em texto livre (objeto da licitação e descrição dos itens), ex.: \"lápis\".",
    },
    ufs: {
      type: "array",
      items: { type: "string" },
      description: "Siglas de UF, ex.: [\"RJ\", \"SP\"]. Valores desconhecidos são ignorados.",
    },
    statuses: {
      type: "array",
      items: { type: "string", enum: STATUSES },
      description: `Situação da licitação. Padrão: ${statusDefault}.`,
    },
    modalidadeIds: {
      type: "array",
      items: { type: "integer" },
      description: "IDs de modalidade do PNCP (ex.: 6 = pregão eletrônico).",
    },
    valorMin: { type: "number", description: "Valor total estimado mínimo, em reais." },
    valorMax: { type: "number", description: "Valor total estimado máximo, em reais." },
    limit: {
      type: "integer",
      description: `Quantidade de resultados (1 a ${MAX_LIMIT}, padrão ${DEFAULT_LIMIT}).`,
    },
  };
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "search_procurements",
    description:
      "Busca licitações públicas por texto, UF, modalidade, faixa de valor e situação. " +
      "Use quando o usuário quiser encontrar oportunidades em geral, sem pedir avaliação " +
      "de compatibilidade com a empresa dele.",
    parameters: {
      type: "object",
      properties: buscaProperties("[\"aberta\"]"),
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "search_my_matches",
    description:
      "Busca licitações compatíveis com o perfil da empresa logada, já pontuadas (score 0–100) " +
      "e com os motivos da pontuação. Use quando o usuário perguntar o que a empresa dele pode " +
      "participar, o que combina com ela ou pedir recomendações.",
    parameters: {
      type: "object",
      properties: buscaProperties("[\"aberta\", \"vai_abrir\"]"),
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "get_procurement",
    description:
      "Retorna os detalhes de uma licitação: dados da compra, itens, documentos (edital e anexos), " +
      "resumo do enriquecimento (categorias, requisitos, riscos, entrega) e o parecer da análise, " +
      "quando houver.",
    parameters: {
      type: "object",
      properties: {
        numero: {
          type: "string",
          description:
            "Número de controle PNCP, no formato 00000000000000-0-000000/0000.",
        },
      },
      required: ["numero"],
      additionalProperties: false,
    },
  },
  {
    name: "calculate_match",
    description:
      "Calcula a compatibilidade (score e motivos) entre a empresa logada e até 10 licitações " +
      "já identificadas. Use para comparar ou pontuar licitações que já apareceram na conversa.",
    parameters: {
      type: "object",
      properties: {
        numeros: {
          type: "array",
          items: { type: "string" },
          description: "De 1 a 10 números de controle PNCP.",
          minItems: 1,
          maxItems: MAX_NUMEROS,
        },
      },
      required: ["numeros"],
      additionalProperties: false,
    },
  },
  {
    name: "analyze_procurement",
    description:
      "Reúne tudo sobre uma licitação (detalhes, itens, documentos, enriquecimento, análise), " +
      "mais o score de compatibilidade e o perfil da empresa logada, para você explicar se vale " +
      "a pena participar, quais requisitos ela provavelmente atende e quais são os riscos.",
    parameters: {
      type: "object",
      properties: {
        numero: {
          type: "string",
          description:
            "Número de controle PNCP, no formato 00000000000000-0-000000/0000.",
        },
      },
      required: ["numero"],
      additionalProperties: false,
    },
  },
];

/**
 * Runs one tool call. Never throws: an unknown name, an invalid argument or a
 * database failure all come back as `{ ok: false, erro }` so the model can
 * recover in-conversation. `ctx.empresaId` is the only source of tenancy.
 */
export async function executeTool(
  name: string,
  args: unknown,
  ctx: ToolContext,
): Promise<ToolResult> {
  try {
    switch (name) {
      case "search_procurements":
        return await searchProcurements(args);
      case "search_my_matches":
        return await searchMyMatches(args, ctx);
      case "get_procurement":
        return await getProcurement(args);
      case "calculate_match":
        return await calculateMatch(args, ctx);
      case "analyze_procurement":
        return await analyzeProcurement(args, ctx);
      default:
        return { ok: false, erro: "ferramenta desconhecida" };
    }
  } catch (error) {
    console.error(`[agent] tool ${name} failed`, error);
    return { ok: false, erro: "falha ao consultar" };
  }
}
