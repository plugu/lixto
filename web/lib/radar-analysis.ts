// "Analisar com IA" on /radar/[id] (ticket 129): a cached, on-demand LLM pass
// that answers why an opportunity may happen, whether it fits the company,
// and how to prepare — called at most once per opportunity×company (the
// result is cached in `future_opportunity_analyses`, ticket 124).
//
// Pattern: web/lib/recommend.ts (pure prompt builder + parser, injectable
// OpenAI client). Unlike recommend.ts this is invoked directly from a server
// action for one opportunity, not a batch — there is no `agent_runs` row.
//
// Relative imports (not "@/lib/...") on purpose: vitest runs without a config
// file, so the tsconfig "@/" alias is not resolvable from lib tests.

import type OpenAI from "openai";

import { getChatClient } from "./agent/llm";
import type { RadarDetail } from "./radar-detail-queries";
import {
  countAnalysesToday,
  getAnalysis,
  insertAnalysis,
} from "./radar-analysis-queries";
import { chipLabel } from "./radar-labels";
import { formatCurrencyBRL, formatDateBR } from "./format";
import type { CompanyProfile } from "./profile-queries";
import { getProfile } from "./profile-queries";
import { fetchRadarDetail } from "./radar-detail-queries";

/** Same fallback chain as recommend.ts's RECOMMEND_MODEL: a dedicated env var
 * first, then the shared recommend model, then a hardcoded default. */
export const RADAR_ANALYSIS_MODEL =
  process.env.LIXTO_RADAR_ANALYSIS_MODEL ??
  process.env.LIXTO_RECOMMEND_MODEL ??
  "gpt-5.1";

/** Hard limit per company per day. `0` (or unset falling back to the
 * default... no: unset falls back to 20) means unlimited — see
 * `LIXTO_RADAR_ANALYSIS_DAILY_CAP` in the deploy env table. */
export const RADAR_ANALYSIS_DAILY_CAP = (() => {
  const raw = process.env.LIXTO_RADAR_ANALYSIS_DAILY_CAP;
  if (raw === undefined || raw.trim() === "") return 20;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 20;
})();

const FIELD_MAX = 800;
const PREPARATION_MAX_ITEMS = 6;

const MISSING_KEY_ERROR = "sem chave de API configurada";
const CAP_ERROR = "limite diário de análises atingido";
const PARSE_ERROR = "não foi possível gerar a análise";

export type RadarAnalysis = {
  why_it_may_happen: string;
  company_fit: string;
  preparation: string[];
};

export type AnalyzeOpportunityResult =
  | { analysis: RadarAnalysis; model: string; created_at: Date | string; cached: boolean }
  | { error: string };

export type RadarAnalysisPromptInput = {
  opportunity: RadarDetail;
  profile: CompanyProfile | null;
};

function line(label: string, value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (Array.isArray(value) && value.length === 0) return null;
  return `- ${label}: ${Array.isArray(value) ? value.join(", ") : value}`;
}

export const RADAR_ANALYSIS_SYSTEM_PROMPT = [
  "Você é o Lixto, analista de compras públicas brasileiras.",
  "O usuário vê uma oportunidade FUTURA: um item do Plano Anual de Contratações (PCA) de um órgão,",
  "ainda sem edital publicado. Nada aqui é uma licitação confirmada.",
  "Use apenas os fatos fornecidos abaixo — não invente exigências, concorrentes, histórico do órgão",
  "ou dados de mercado que não estejam no texto. Esta versão do produto não tem dados de histórico",
  "do órgão nem de concorrência: nunca mencione ou estime nenhum dos dois.",
  "Use linguagem sempre em condicional/estimativa (\"provável\", \"estimado\", \"sinal detectado\",",
  "\"pode indicar\") — nunca afirme como fato consumado que a compra vai acontecer.",
  'Responda SOMENTE com um JSON válido no formato: {"why_it_may_happen": string, "company_fit": string, "preparation": string[]}.',
  `Cada um dos dois textos deve ter no máximo ${FIELD_MAX} caracteres, em português do Brasil.`,
  `"preparation" é uma lista de no máximo ${PREPARATION_MAX_ITEMS} passos curtos e acionáveis.`,
].join(" ");

/** Pure: everything the model sees, assembled from the same facts the page
 * already renders (RadarDetail + the company profile). Exported so tests can
 * read the exact text without a database. */
export function buildRadarAnalysisPrompt(input: RadarAnalysisPromptInput): {
  system: string;
  user: string;
} {
  const { opportunity, profile } = input;
  const parts: string[] = [];

  parts.push(
    [
      "## Oportunidade futura (item do PCA)",
      line("Título", opportunity.title),
      line("Órgão", opportunity.agency_name),
      line("Unidade", opportunity.unit_name),
      line(
        "Local",
        [opportunity.city_name, opportunity.state].filter(Boolean).join("/"),
      ),
      line("Valor estimado (R$)", formatCurrencyBRL(opportunity.estimated_value)),
      line("Quantidade estimada", opportunity.estimated_quantity),
      line(
        "Data prevista",
        opportunity.expected_date ? formatDateBR(opportunity.expected_date) : null,
      ),
      line("Ano do PCA", opportunity.plan_year),
      line(
        "Classificação",
        [
          opportunity.pdm_description,
          opportunity.catalog_classification_name,
          opportunity.superior_classification_name,
        ]
          .filter(Boolean)
          .join(" · ") || null,
      ),
    ]
      .filter(Boolean)
      .join("\n"),
  );

  parts.push(
    [
      "## Por que o radar mostra isso (sinais de probabilidade)",
      opportunity.signals.length > 0
        ? opportunity.signals
            .map((s) => `- ${chipLabel(s.code)} (${s.weight}): ${s.detail}`)
            .join("\n")
        : "- (nenhum sinal registrado)",
    ].join("\n"),
  );

  parts.push(
    [
      "## Por que o radar acha que combina com a empresa (motivos de aderência)",
      opportunity.reasons.length > 0
        ? opportunity.reasons
            .map((r) => `- ${chipLabel(r.code)} (${r.weight}): ${r.detail}`)
            .join("\n")
        : "- (nenhum motivo registrado)",
    ].join("\n"),
  );

  parts.push(
    [
      "## Perfil da empresa",
      line("Produtos/serviços", profile?.products),
      line("Palavras-chave", profile?.keywords),
      line("Exclusões (não atende)", profile?.exclusions),
      line("Estados atendidos", profile?.states),
      line(
        "Faixa de valor (R$)",
        profile && (profile.min_value || profile.max_value)
          ? `${profile.min_value ?? "sem mínimo"} a ${profile.max_value ?? "sem máximo"}`
          : null,
      ),
      line("Observações", profile?.notes),
    ]
      .filter(Boolean)
      .join("\n"),
  );

  parts.push(
    [
      "## Resposta",
      'Responda SOMENTE com JSON: {"why_it_may_happen": string, "company_fit": string, "preparation": string[]}.',
      "Não inclua seções sobre histórico do órgão ou concorrência: essa versão do produto não tem esses dados.",
    ].join("\n"),
  );

  return { system: RADAR_ANALYSIS_SYSTEM_PROMPT, user: parts.join("\n\n") };
}

/** Tolerant on purpose: models wrap JSON in ```json fences even when asked
 * not to. Anything we cannot turn into a valid shape is `null`. */
export function parseRadarAnalysis(text: string): RadarAnalysis | null {
  if (!text) return null;
  let body = text.trim();
  const fenced = body.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) body = fenced[1].trim();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end <= start) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;

  const obj = parsed as Record<string, unknown>;
  const whyItMayHappen =
    typeof obj.why_it_may_happen === "string" ? obj.why_it_may_happen.trim() : "";
  const companyFit =
    typeof obj.company_fit === "string" ? obj.company_fit.trim() : "";
  if (!whyItMayHappen || !companyFit) return null;

  const rawPreparation = Array.isArray(obj.preparation) ? obj.preparation : [];
  const preparation = rawPreparation
    .filter((item): item is string => typeof item === "string" && item.trim() !== "")
    .map((item) => item.trim().slice(0, FIELD_MAX))
    .slice(0, PREPARATION_MAX_ITEMS);

  return {
    why_it_may_happen: whyItMayHappen.slice(0, FIELD_MAX),
    company_fit: companyFit.slice(0, FIELD_MAX),
    preparation,
  };
}

function hasApiKey(): boolean {
  return Boolean(process.env.LIXTO_LLM_API_KEY ?? process.env.OPENAI_API_KEY);
}

/**
 * Returns the cached analysis if one already exists (no LLM call, `cached:
 * true`); otherwise enforces the daily cap, loads the opportunity + profile,
 * calls the model once, parses and persists the result.
 */
export async function analyzeOpportunity(
  companyId: number,
  id: number,
  deps: { client?: OpenAI } = {},
): Promise<AnalyzeOpportunityResult> {
  const cached = await getAnalysis(companyId, id);
  if (cached) {
    return {
      analysis: cached.content,
      model: cached.model,
      created_at: cached.created_at,
      cached: true,
    };
  }

  if (RADAR_ANALYSIS_DAILY_CAP > 0) {
    const used = await countAnalysesToday(companyId);
    if (used >= RADAR_ANALYSIS_DAILY_CAP) {
      return { error: CAP_ERROR };
    }
  }

  const client = deps.client ?? (hasApiKey() ? getChatClient() : undefined);
  if (!client) {
    return { error: MISSING_KEY_ERROR };
  }

  const [opportunity, profile] = await Promise.all([
    fetchRadarDetail(companyId, id),
    getProfile(companyId),
  ]);
  if (!opportunity) {
    return { error: PARSE_ERROR };
  }

  const prompt = buildRadarAnalysisPrompt({ opportunity, profile });

  let text: string;
  try {
    const completion = await client.chat.completions.create({
      model: RADAR_ANALYSIS_MODEL,
      messages: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user },
      ],
      response_format: { type: "json_object" },
    });
    text = completion.choices?.[0]?.message?.content ?? "";
  } catch {
    return { error: PARSE_ERROR };
  }

  const analysis = parseRadarAnalysis(text);
  if (!analysis) {
    return { error: PARSE_ERROR };
  }

  const row = await insertAnalysis(companyId, id, RADAR_ANALYSIS_MODEL, analysis);
  return {
    analysis: row.content,
    model: row.model,
    created_at: row.created_at,
    cached: false,
  };
}
