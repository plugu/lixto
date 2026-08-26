// The safe tool layer the chat model calls.
//
// Rules this file exists to enforce:
//  1. The model never writes SQL. It emits a tool name + JSON arguments; every
//     tool maps them onto an existing query builder with bound parameters.
//  2. `companyId` comes from `ToolContext` (i.e. the session) only. No tool
//     accepts, reads or forwards a company id from the model's arguments.
//  3. Arguments are validated by hand, `parseFilters`-style: unknown or
//     invalid values are dropped, never thrown back at the model as a stack
//     trace. Query failures become a short PT-BR `error` string; the real
//     error goes to `console.error` for us.
//  4. `data` stays small (items capped, texts truncated) — every field here is
//     billed as prompt tokens on the next turn.

import { getCompanyCnaes } from "../company-queries";
import { fetchEnrichment } from "../enrichment-queries";
import type { Reason } from "../match-engine";
import { fetchMatches, type MatchFilters, type MatchRow } from "../match-queries";
import {
  ATTENTION_SCORE,
  getOpportunity,
  listOpportunities,
  type OpportunityRow,
  type OpportunityState,
} from "../opportunity-queries";
import {
  fetchDocuments,
  fetchItems,
  fetchProcurementDetail,
} from "../procurement-detail-queries";
import {
  fetchProcurements,
  type ProcurementFilters,
} from "../procurement-queries";
import { getProfile } from "../profile-queries";
import { computeProcurementStatus, type ProcurementStatus } from "../status";
import { UF_LIST } from "../types";
import { embedQuery } from "./embed";
import type {
  ProcurementRef,
  ToolContext,
  ToolDefinition,
  ToolResult,
} from "./types";

/** PNCP control number: `<cnpj14>-<digito>-<sequencial6>/<ano>`. */
const SOURCE_ID_RE = /^\d{14}-\d-\d{6}\/\d{4}$/;

const STATUSES: ProcurementStatus[] = ["open", "upcoming", "closed"];

/** How much free text ever reaches the model per field. */
const MAX_TEXT = 160;
const MAX_ITEMS = 20;
const MAX_DOCUMENTS = 10;
const MAX_LIMIT = 20;
const DEFAULT_LIMIT = 10;
const MAX_SOURCE_IDS = 10;

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
export function asState(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const state = value.trim().toUpperCase();
  return UF_LIST.includes(state) ? state : undefined;
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

function asStatuses(value: unknown): ProcurementStatus[] {
  return asStringArray(value).filter((v): v is ProcurementStatus =>
    (STATUSES as string[]).includes(v),
  );
}

function asLimit(value: unknown): number {
  const n = asNumber(value);
  if (n === undefined) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.trunc(n)));
}

function truncate(text: string | null, max = MAX_TEXT): string | null {
  if (text === null) return null;
  const trimmed = text.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}

function iso(date: Date | string | null): string | null {
  if (date === null) return null;
  const value = typeof date === "string" ? new Date(date) : date;
  return Number.isNaN(value.getTime()) ? null : value.toISOString();
}

/** The search args shared by `search_procurements` and `search_my_matches`.
 * `statuses` falls back to the caller-supplied default. */
function parseSearchArgs(
  args: unknown,
  defaultStatuses: ProcurementStatus[],
): { filters: MatchFilters & ProcurementFilters; limit: number } {
  const raw = asRecord(args);
  const filters: MatchFilters & ProcurementFilters = {};

  const q = asString(raw.q);
  if (q) filters.q = q;

  const states = asStringArray(raw.states)
    .map(asState)
    .filter((state): state is string => state !== undefined);
  if (states.length > 0) filters.states = states;

  const statuses = asStatuses(raw.statuses);
  filters.statuses = statuses.length > 0 ? statuses : defaultStatuses;

  const modalityIds = asIntArray(raw.modalityIds);
  if (modalityIds.length > 0) filters.modalityIds = modalityIds;

  const valueMin = asNumber(raw.valueMin);
  if (valueMin !== undefined) filters.valueMin = valueMin;

  const valueMax = asNumber(raw.valueMax);
  if (valueMax !== undefined) filters.valueMax = valueMax;

  return { filters, limit: asLimit(raw.limit) };
}

// ---------------------------------------------------------------------------
// Row → card shapes
// ---------------------------------------------------------------------------

type RefSource = {
  source_id: string;
  description: string | null;
  agency_name: string | null;
  state: string | null;
  city_name: string | null;
  modality_name: string | null;
  estimated_value: string | null;
  proposal_opens_at: Date | null;
  proposal_closes_at: Date | null;
  /** Only `ProcurementRow` (hybrid search) carries this; absent elsewhere. */
  match_kind?: "keyword" | "semantic" | "both" | null;
};

function toRef(
  row: RefSource,
  extra?: { score: number; reasons: Reason[] },
): ProcurementRef {
  return {
    source_id: row.source_id,
    description: truncate(row.description),
    agency: row.agency_name,
    state: row.state,
    city: row.city_name,
    modality: row.modality_name,
    estimated_value: row.estimated_value,
    closes_at: iso(row.proposal_closes_at),
    status: computeProcurementStatus(
      row.proposal_opens_at,
      row.proposal_closes_at,
    ),
    ...(row.match_kind ? { match_kind: row.match_kind } : {}),
    ...(extra ?? {}),
  };
}

function matchRefs(rows: MatchRow[]): ProcurementRef[] {
  return rows.map((row) => toRef(row, { score: row.score, reasons: row.reasons }));
}

/** `opportunities` rows carry `state_uf` (not `state`, reserved for the
 * lifecycle state) and no `proposal_opens_at` — the batch only tracks
 * open/upcoming procurements, but this row shape can't distinguish them, so
 * the ref's `status` falls back to whatever `computeProcurementStatus` does
 * with an unknown opening date. */
function opportunityRef(row: OpportunityRow): ProcurementRef {
  return {
    source_id: row.source_id,
    description: truncate(row.description),
    agency: row.agency_name,
    state: row.state_uf,
    city: row.city_name,
    modality: row.modality_name,
    estimated_value: row.estimated_value,
    closes_at: iso(row.proposal_closes_at),
    status: computeProcurementStatus(null, row.proposal_closes_at),
    score: row.score,
    reasons: row.reasons,
  };
}

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

const ERROR_SOURCE_ID = "número de controle inválido";
const ERROR_NOT_FOUND = "licitação não encontrada";
const ERROR_OPPORTUNITY_NOT_FOUND = "oportunidade não encontrada";

const OPPORTUNITY_VIEWS = ["attention", "all", "dismissed"] as const;
type OpportunityView = (typeof OPPORTUNITY_VIEWS)[number];

function asOpportunityView(value: unknown): OpportunityView {
  return typeof value === "string" &&
    (OPPORTUNITY_VIEWS as readonly string[]).includes(value)
    ? (value as OpportunityView)
    : "attention";
}

async function searchProcurements(args: unknown): Promise<ToolResult> {
  const { filters, limit } = parseSearchArgs(args, ["open"]);
  const qEmbedding = filters.q ? await embedQuery(filters.q) : undefined;
  const { rows, total } = await fetchProcurements(
    filters,
    limit,
    0,
    undefined,
    qEmbedding,
  );
  const refs = rows.map((row) => toRef(row));
  return { ok: true, data: { total, items: refs }, refs };
}

/** True when the company has neither a match profile nor CNAEs — matching
 * would have nothing to score against, so we point the user at the form
 * instead of returning an empty list they can't interpret. */
async function hasNoMatchProfile(companyId: number): Promise<boolean> {
  const [profile, cnaes] = await Promise.all([
    getProfile(companyId),
    getCompanyCnaes(companyId),
  ]);
  return profile === null && cnaes.length === 0;
}

async function searchMyMatches(
  args: unknown,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (await hasNoMatchProfile(ctx.companyId)) {
    return {
      ok: true,
      data: { warning: "perfil de match não configurado", url: "/company/profile" },
      refs: [],
    };
  }
  const { filters, limit } = parseSearchArgs(args, ["open", "upcoming"]);
  const rows = await fetchMatches(ctx.companyId, filters, limit);
  const refs = matchRefs(rows);
  return { ok: true, data: { total: refs.length, items: refs }, refs };
}

/** Detail + items + documents + enrichment for one procurement, already
 * trimmed to what the model needs. Returns null when it doesn't exist. Shared
 * by `get_procurement` and `analyze_procurement`. */
async function dossier(sourceId: string) {
  const detail = await fetchProcurementDetail(sourceId);
  if (detail === null) return null;

  const [items, documents, enrichment] = await Promise.all([
    fetchItems(detail.id),
    fetchDocuments(detail.id),
    fetchEnrichment(detail.id),
  ]);

  const data = {
    procurement: {
      source_id: detail.source_id,
      description: detail.description,
      agency: detail.agency_name,
      unit: detail.unit_name,
      state: detail.state,
      city: detail.city_name,
      modality: detail.modality_name,
      dispute_mode: detail.dispute_mode_name,
      situation: detail.status_name,
      price_registry: detail.is_price_registry,
      estimated_value: detail.estimated_value,
      opens_at: iso(detail.proposal_opens_at),
      closes_at: iso(detail.proposal_closes_at),
      status: computeProcurementStatus(
        detail.proposal_opens_at,
        detail.proposal_closes_at,
      ),
      link: detail.origin_url,
    },
    items_total: items.length,
    items: items.slice(0, MAX_ITEMS).map((item) => ({
      item_number: item.item_number,
      description: truncate(item.description),
      quantity: item.quantity,
      unit: item.unit,
      estimated_unit_price: item.estimated_unit_price,
      estimated_total: item.estimated_total,
      benefit: item.benefit_type_name,
    })),
    documents: documents.slice(0, MAX_DOCUMENTS).map((doc) => ({
      title: doc.title,
      url: doc.url,
    })),
    enrichment: enrichment
      ? {
          summary: enrichment.summary,
          categories: enrichment.categories,
          requirements: enrichment.requirements,
          risks: enrichment.risks,
          delivery_location: enrichment.delivery_location,
          delivery_deadline_days: enrichment.delivery_deadline_days,
          me_epp_exclusive: enrichment.me_epp_exclusive,
        }
      : null,
  };

  return { detail, data };
}

async function getProcurement(args: unknown): Promise<ToolResult> {
  const sourceId = asString(asRecord(args).sourceId);
  if (!sourceId || !SOURCE_ID_RE.test(sourceId)) {
    return { ok: false, error: ERROR_SOURCE_ID };
  }

  const found = await dossier(sourceId);
  if (found === null) return { ok: false, error: ERROR_NOT_FOUND };

  return {
    ok: true,
    data: found.data,
    refs: [toRef(found.detail)],
  };
}

/** Scores the given source ids for this company. All three statuses are
 * allowed: the user may ask about a procurement that has already closed. */
async function matchesFor(
  companyId: number,
  sourceIds: string[],
): Promise<MatchRow[]> {
  return fetchMatches(
    companyId,
    { sourceIds, statuses: ["open", "upcoming", "closed"] },
    sourceIds.length,
  );
}

async function calculateMatch(
  args: unknown,
  ctx: ToolContext,
): Promise<ToolResult> {
  const sourceIds = asStringArray(asRecord(args).sourceIds).slice(
    0,
    MAX_SOURCE_IDS,
  );
  if (sourceIds.length === 0 || !sourceIds.every((n) => SOURCE_ID_RE.test(n))) {
    return { ok: false, error: ERROR_SOURCE_ID };
  }

  const rows = await matchesFor(ctx.companyId, sourceIds);
  const bySourceId = new Map(rows.map((row) => [row.source_id, row]));

  return {
    ok: true,
    data: {
      matches: sourceIds.map((sourceId) => {
        const row = bySourceId.get(sourceId);
        return {
          source_id: sourceId,
          score: row?.score ?? null,
          reasons: row?.reasons ?? [],
          found: row !== undefined,
        };
      }),
    },
    refs: matchRefs(rows),
  };
}

async function analyzeProcurement(
  args: unknown,
  ctx: ToolContext,
): Promise<ToolResult> {
  const sourceId = asString(asRecord(args).sourceId);
  if (!sourceId || !SOURCE_ID_RE.test(sourceId)) {
    return { ok: false, error: ERROR_SOURCE_ID };
  }

  const found = await dossier(sourceId);
  if (found === null) return { ok: false, error: ERROR_NOT_FOUND };

  const [rows, profile] = await Promise.all([
    matchesFor(ctx.companyId, [sourceId]),
    getProfile(ctx.companyId),
  ]);
  const row = rows.find((r) => r.source_id === sourceId);

  const data = {
    ...found.data,
    match: row ? { score: row.score, reasons: row.reasons } : null,
    company: {
      name: ctx.companyName,
      size: ctx.size,
      terms: profile?.terms ?? [],
      exclusions: profile?.exclusion_terms ?? [],
      states: profile?.states ?? [],
      min_value: profile?.min_value ?? null,
      max_value: profile?.max_value ?? null,
    },
  };

  const ref = row
    ? toRef(found.detail, { score: row.score, reasons: row.reasons })
    : toRef(found.detail);

  return { ok: true, data, refs: [ref] };
}

/** `attention` (default): opportunities the batch flagged as deserving
 * attention (score ≥ 70, still active). `all`: every opportunity regardless
 * of score. `dismissed`: what the user discarded. `matched`/`recommended`
 * both count as "active" per PRODUCT.md — dismissed/executed ones don't show
 * up outside their own view. */
async function listOpportunitiesTool(
  args: unknown,
  ctx: ToolContext,
): Promise<ToolResult> {
  const raw = asRecord(args);
  const view = asOpportunityView(raw.view);
  const limit = asLimit(raw.limit);

  const opts: { states?: OpportunityState[]; minScore?: number; limit: number } = {
    limit,
  };
  if (view === "attention") {
    opts.states = ["matched", "recommended"];
    opts.minScore = ATTENTION_SCORE;
  } else if (view === "dismissed") {
    opts.states = ["dismissed"];
  }

  const rows = await listOpportunities(ctx.companyId, opts);
  const refs = rows.map((row) => opportunityRef(row));
  const items = rows.map((row) => ({
    source_id: row.source_id,
    score: row.score,
    verdict: row.verdict,
    closes_at: iso(row.proposal_closes_at),
    description: truncate(row.description),
  }));

  return { ok: true, data: { total: items.length, items }, refs };
}

async function explainOpportunity(
  args: unknown,
  ctx: ToolContext,
): Promise<ToolResult> {
  const sourceId = asString(asRecord(args).source_id);
  if (!sourceId || !SOURCE_ID_RE.test(sourceId)) {
    return { ok: false, error: ERROR_SOURCE_ID };
  }

  const row = await getOpportunity(ctx.companyId, sourceId);
  if (row === null) return { ok: false, error: ERROR_OPPORTUNITY_NOT_FOUND };

  const data = {
    score: row.score,
    reasons: row.reasons.map((reason) => ({
      code: reason.code,
      detail: reason.detail,
    })),
    verdict: row.verdict,
    rationale: row.rationale ?? "sem recomendação ainda",
    state: row.state,
  };

  return { ok: true, data, refs: [opportunityRef(row)] };
}

// ---------------------------------------------------------------------------
// Declarations + dispatch
// ---------------------------------------------------------------------------

/** JSON Schema fragment shared by the two search tools. */
function searchProperties(statusDefault: string): Record<string, unknown> {
  return {
    q: {
      type: "string",
      description:
        "Termo de busca em texto livre (objeto da licitação e descrição dos itens), ex.: \"lápis\".",
    },
    states: {
      type: "array",
      items: { type: "string" },
      description:
        "Siglas de UF, ex.: [\"RJ\", \"SP\"]. Valores desconhecidos são ignorados.",
    },
    statuses: {
      type: "array",
      items: { type: "string", enum: STATUSES },
      description: `Situação: open (aberta), upcoming (vai abrir), closed (fechada). Padrão: ${statusDefault}.`,
    },
    modalityIds: {
      type: "array",
      items: { type: "integer" },
      description: "IDs de modalidade do PNCP (ex.: 6 = pregão eletrônico).",
    },
    valueMin: {
      type: "number",
      description: "Valor total estimado mínimo, em reais.",
    },
    valueMax: {
      type: "number",
      description: "Valor total estimado máximo, em reais.",
    },
    limit: {
      type: "integer",
      description: `Quantidade de resultados (1 a ${MAX_LIMIT}, padrão ${DEFAULT_LIMIT}).`,
    },
  };
}

const SOURCE_ID_PROPERTY = {
  type: "string",
  description: "Número de controle PNCP, no formato 00000000000000-0-000000/0000.",
};

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "search_procurements",
    description:
      "Busca licitações públicas por texto, UF, modalidade, faixa de valor e situação. " +
      "A busca por texto é semântica: encontra sinônimos e paráfrases mesmo sem palavras " +
      "em comum (ex.: \"material escolar\" encontra \"cadernos e lápis\"), então passe o " +
      "termo como o usuário disse, sem reescrever em palavras-chave. Use quando o usuário " +
      "quiser encontrar oportunidades em geral, sem pedir avaliação de compatibilidade " +
      "com a empresa dele.",
    parameters: {
      type: "object",
      properties: searchProperties("[\"open\"]"),
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
      properties: searchProperties("[\"open\", \"upcoming\"]"),
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "get_procurement",
    description:
      "Retorna os detalhes de uma licitação: dados da compra, itens, documentos (edital e anexos) " +
      "e o que foi extraído do edital (categorias, requisitos, riscos, entrega), quando houver.",
    parameters: {
      type: "object",
      properties: { sourceId: SOURCE_ID_PROPERTY },
      required: ["sourceId"],
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
        sourceIds: {
          type: "array",
          items: { type: "string" },
          description: "De 1 a 10 números de controle PNCP.",
          minItems: 1,
          maxItems: MAX_SOURCE_IDS,
        },
      },
      required: ["sourceIds"],
      additionalProperties: false,
    },
  },
  {
    name: "analyze_procurement",
    description:
      "Reúne tudo sobre uma licitação (detalhes, itens, documentos, dados do edital), mais o score " +
      "de compatibilidade e o perfil da empresa logada, para você explicar se vale a pena " +
      "participar, quais requisitos ela provavelmente atende e quais são os riscos.",
    parameters: {
      type: "object",
      properties: { sourceId: SOURCE_ID_PROPERTY },
      required: ["sourceId"],
      additionalProperties: false,
    },
  },
  {
    name: "list_opportunities",
    description:
      "Lista as oportunidades já analisadas pelo agente para a empresa logada (rodadas diárias de " +
      "match), com score e situação. Use para 'o que você encontrou hoje', 'quais oportunidades' ou " +
      "'o que apareceu' — o resumo diário é a fonte da verdade para 'hoje'.",
    parameters: {
      type: "object",
      properties: {
        view: {
          type: "string",
          enum: OPPORTUNITY_VIEWS as unknown as string[],
          description:
            "attention: só as que merecem atenção (score alto, padrão). all: todas. " +
            "dismissed: as descartadas pelo usuário.",
        },
        limit: {
          type: "integer",
          description: `Quantidade de resultados (1 a ${MAX_LIMIT}, padrão ${DEFAULT_LIMIT}).`,
        },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "explain_opportunity",
    description:
      "Explica uma oportunidade específica já analisada pelo agente: score, motivos, e o parecer " +
      "GO/NO-GO com a justificativa, quando houver. Use para 'por que essa?' ou 'por que essa " +
      "licitação apareceu'.",
    parameters: {
      type: "object",
      properties: { source_id: SOURCE_ID_PROPERTY },
      required: ["source_id"],
      additionalProperties: false,
    },
  },
];

/**
 * Runs one tool call. Never throws: an unknown name, an invalid argument or a
 * database failure all come back as `{ ok: false, error }` so the model can
 * recover in-conversation. `ctx.companyId` is the only source of tenancy.
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
      case "list_opportunities":
        return await listOpportunitiesTool(args, ctx);
      case "explain_opportunity":
        return await explainOpportunity(args, ctx);
      default:
        return { ok: false, error: "ferramenta desconhecida" };
    }
  } catch (err) {
    console.error(`[agent] tool ${name} failed`, err);
    return { ok: false, error: "falha ao consultar" };
  }
}
