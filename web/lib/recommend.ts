// The bounded GO/NO-GO pass (PRODUCT §2): for each company, at most
// RECOMMEND_DAILY_CAP of its attention-worthy opportunities get one Tier-3
// call that answers "vale a pena participar?" in Portuguese.
//
// This is the only LLM spend of the proactive loop — matching is deterministic
// and free, so the cap is a hard limit, not a suggestion. Nothing here acts on
// the user's behalf: the run writes a `recommendations` row and moves the
// opportunity to `recommended`, and that is all.
//
// Failures are per item: a broken enrichment, a truncated JSON reply or a
// missing API key cost that one opportunity, never the run (the digest of
// ticket 93 must render even when the model is down).
//
// Relative imports (not "@/lib/...") on purpose: vitest runs without a config
// file, so the tsconfig "@/" alias is not resolvable from lib tests.

import type OpenAI from "openai";

import { getChatClient } from "./agent/llm";
import { getCompany, getCompanyCnaes } from "./company-queries";
import { pool } from "./db";
import { listDocuments } from "./document-queries";
import {
  REQUIREMENT_KIND_LABELS,
  fetchEnrichment,
  type EnrichmentRow,
} from "./enrichment-queries";
import { setOpportunityState } from "./opportunity-queries";
import { getProfile, type CompanyProfile } from "./profile-queries";
import {
  countRecommendationsToday,
  insertRecommendation,
  listCandidatesForRecommendation,
  listCompaniesWithCandidates,
  type RecommendationCandidate,
  type Verdict,
} from "./recommendation-queries";
import { DOCUMENT_KINDS, type Company, type CompanyCnae } from "./types";

/** Hard limit per company per day (PRODUCT §2). */
export const RECOMMEND_DAILY_CAP = 5;

/** Tier 3: the verdict is the one place where a better model pays for itself. */
export const RECOMMEND_MODEL = process.env.LIXTO_RECOMMEND_MODEL ?? "gpt-5.1";

/** Rationale budget, enforced on the way in *and* on the way out (the model is
 * asked for ≤ 600 chars; `parseRecommendation` truncates if it overshoots). */
const RATIONALE_MAX = 600;

const MISSING_KEY_ERROR =
  "LIXTO_LLM_API_KEY (ou OPENAI_API_KEY) não configurada: nenhuma recomendação foi gerada.";

export type RecommendationOutput = {
  verdict: Verdict;
  rationale: string;
  confidence: number | null;
};

export type RecommendationPromptInput = {
  candidate: RecommendationCandidate;
  enrichment: EnrichmentRow | null;
  company: Company | null;
  cnaes: CompanyCnae[];
  profile: CompanyProfile | null;
  /** `company_documents.kind` values on file — the habilitação the company can
   * already prove. */
  documentKinds: string[];
};

export type RecommendBatchResult = {
  runId: number;
  companies: number;
  recommended: number;
  skipped_cap: number;
  failed: number;
};

const DOCUMENT_KIND_LABELS: Record<string, string> = Object.fromEntries(
  DOCUMENT_KINDS.map((k) => [k.value, k.label]),
);

function line(label: string, value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (Array.isArray(value) && value.length === 0) return null;
  return `- ${label}: ${Array.isArray(value) ? value.join(", ") : value}`;
}

export const RECOMMEND_SYSTEM_PROMPT = [
  "Você é o Lixto, analista de licitações públicas brasileiras.",
  "Com base nos dados abaixo, decida GO / NO_GO / BORDERLINE para a empresa participar desta licitação.",
  "Considere habilitação exigida (o que a empresa já tem documentado), porte e benefício ME/EPP,",
  "aderência do objeto ao que a empresa vende, estado/entrega, faixa de valor, riscos e prazo.",
  "Seja conservador: exigência que a empresa comprovadamente não cumpre é NO_GO;",
  "dúvida relevante (falta informação, exigência incerta) é BORDERLINE.",
  "Não invente exigências que não estejam nos dados. Responda apenas com JSON válido.",
].join(" ");

/** Pure: everything the model sees, assembled from rows the caller already
 * fetched. Exported so the tests (and a future "por que essa?" tool) can read
 * the exact text without a database. */
export function buildRecommendationPrompt(input: RecommendationPromptInput): {
  system: string;
  user: string;
} {
  const { candidate, enrichment, company, cnaes, profile, documentKinds } =
    input;

  const parts: string[] = [];

  parts.push(
    [
      "## Licitação",
      line("Identificador", candidate.sourceId),
      line("Objeto", candidate.description),
      line("Órgão", candidate.agency_name),
      line(
        "Local",
        [candidate.city_name, candidate.state_uf].filter(Boolean).join("/"),
      ),
      line("Modalidade", candidate.modality_name),
      line("Valor estimado (R$)", candidate.estimated_value),
      line(
        "Encerra em",
        candidate.proposal_closes_at
          ? // `new Date(...)`: pg gives a Date, but a JSON round trip gives a
            // string and the prompt must read the same either way.
            new Date(candidate.proposal_closes_at).toISOString()
          : null,
      ),
    ]
      .filter(Boolean)
      .join("\n"),
  );

  if (enrichment) {
    const requirements = enrichment.requirements ?? [];
    const requirementLines = requirements.map((r) => {
      const label = REQUIREMENT_KIND_LABELS[r.kind] ?? r.kind;
      return `  - [${label}] ${r.description}`;
    });
    parts.push(
      [
        "## Análise do edital",
        line("Resumo", enrichment.summary),
        requirementLines.length > 0
          ? `- Exigências:\n${requirementLines.join("\n")}`
          : null,
        line("Riscos", enrichment.risks),
        line(
          "Entrega",
          [
            enrichment.delivery_location,
            enrichment.delivery_deadline_days === null
              ? null
              : `prazo ${enrichment.delivery_deadline_days} dias`,
          ]
            .filter(Boolean)
            .join(" — ") || null,
        ),
        line("Complexidade", enrichment.complexity),
        line(
          "Exclusivo ME/EPP",
          enrichment.me_epp_exclusive === null
            ? null
            : enrichment.me_epp_exclusive
              ? "sim"
              : "não",
        ),
        line(
          "Preferência ME/EPP",
          enrichment.me_epp_preference === null
            ? null
            : enrichment.me_epp_preference
              ? "sim"
              : "não",
        ),
        line(
          "Exige certificação",
          enrichment.requires_certification === null
            ? null
            : enrichment.requires_certification
              ? "sim"
              : "não",
        ),
        line(
          "Exige atestado de capacidade técnica",
          enrichment.requires_technical_certificate === null
            ? null
            : enrichment.requires_technical_certificate
              ? "sim"
              : "não",
        ),
      ]
        .filter(Boolean)
        .join("\n"),
    );
  } else {
    parts.push("## Análise do edital\n- (edital ainda não analisado)");
  }

  parts.push(
    [
      "## Empresa",
      line("Razão social", company?.legal_name),
      line("Porte", company?.size),
      line("UF", company?.state),
      line(
        "CNAEs",
        cnaes.map(
          (c) =>
            `${c.cnae_code}${c.is_primary ? " (principal)" : ""} ${c.description ?? ""}`.trim(),
        ),
      ),
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
      line(
        "Documentos de habilitação já cadastrados",
        documentKinds.map((k) => DOCUMENT_KIND_LABELS[k] ?? k),
      ),
    ]
      .filter(Boolean)
      .join("\n"),
  );

  parts.push(
    [
      "## Match automático",
      `- Score: ${candidate.score}`,
      candidate.reasons.length > 0
        ? `- Motivos:\n${candidate.reasons
            .map((r) => `  - ${r.code} (${r.weight}) ${r.detail}`)
            .join("\n")}`
        : null,
    ]
      .filter(Boolean)
      .join("\n"),
  );

  parts.push(
    [
      "## Resposta",
      'Responda SOMENTE com JSON: {"verdict": "go"|"no_go"|"borderline", "rationale": string, "confidence": number}.',
      `"rationale": português do Brasil, no máximo ${RATIONALE_MAX} caracteres, citando exigências concretas do edital e o que a empresa tem ou não tem.`,
      '"confidence": número entre 0 e 1.',
    ].join("\n"),
  );

  return { system: RECOMMEND_SYSTEM_PROMPT, user: parts.join("\n\n") };
}

function normalizeVerdict(raw: unknown): Verdict | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (value === "go" || value === "no_go" || value === "borderline") {
    return value;
  }
  if (value === "nogo" || value === "não" || value === "nao") return "no_go";
  return null;
}

/** Tolerant on purpose: models wrap JSON in ```json fences or prepend a
 * sentence even when asked not to. Anything we cannot turn into a valid
 * verdict + rationale is `null`, and the caller counts it as a failure rather
 * than persisting a half-parsed row. */
export function parseRecommendation(text: string): RecommendationOutput | null {
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
  const verdict = normalizeVerdict(obj.verdict);
  if (!verdict) return null;

  const rationale =
    typeof obj.rationale === "string" ? obj.rationale.trim() : "";
  if (!rationale) return null;

  let confidence: number | null = null;
  const rawConfidence =
    typeof obj.confidence === "string" ? Number(obj.confidence) : obj.confidence;
  if (typeof rawConfidence === "number" && Number.isFinite(rawConfidence)) {
    confidence = Math.min(1, Math.max(0, rawConfidence));
  }

  return { verdict, rationale: rationale.slice(0, RATIONALE_MAX), confidence };
}

async function startRun(companyId: number | null): Promise<number> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO agent_runs (kind, company_id, status)
          VALUES ('recommend', $1, 'running')
       RETURNING id`,
    [companyId],
  );
  return Number(rows[0].id);
}

async function finishRun(
  runId: number,
  status: "done" | "failed",
  counters: Record<string, number>,
  error: string | null = null,
): Promise<void> {
  await pool.query(
    `UPDATE agent_runs
        SET status = $2, finished_at = now(), counters = $3::jsonb, error = $4
      WHERE id = $1`,
    [runId, status, JSON.stringify(counters), error],
  );
}

function hasApiKey(): boolean {
  return Boolean(process.env.LIXTO_LLM_API_KEY ?? process.env.OPENAI_API_KEY);
}

/**
 * One GO/NO-GO pass. `limit` is the per-company ceiling for *this* run; the
 * daily cap still wins (a company that already got 4 today gets at most 1
 * more, whatever `limit` says).
 *
 * With no API key the run still opens, still lists its candidates, counts them
 * all as failed and closes `done` carrying the reason in `agent_runs.error` —
 * an operator reading the runs table sees "no key", not an empty run.
 */
export async function runRecommendBatch(
  opts: {
    companyId?: number;
    limit?: number;
    deps?: { client?: OpenAI };
  } = {},
): Promise<RecommendBatchResult> {
  const runId = await startRun(opts.companyId ?? null);

  const counters = {
    companies: 0,
    recommended: 0,
    skipped_cap: 0,
    failed: 0,
  };
  // First failure wins the `error` column; the rest live in the log.
  let firstError: string | null = null;
  const fail = (message: string, err?: unknown) => {
    counters.failed += 1;
    if (!firstError) firstError = message;
    console.error(`[recommend] ${message}`, err ?? "");
  };

  try {
    const companies =
      opts.companyId !== undefined
        ? [opts.companyId]
        : await listCompaniesWithCandidates();
    counters.companies = companies.length;

    const client =
      opts.deps?.client ?? (hasApiKey() ? getChatClient() : undefined);

    for (const companyId of companies) {
      try {
        const used = await countRecommendationsToday(companyId);
        const remaining = RECOMMEND_DAILY_CAP - used;
        if (remaining <= 0) {
          // Counted per company, not per opportunity: once the cap is spent we
          // deliberately do not query how many were left behind.
          counters.skipped_cap += 1;
          continue;
        }

        const take = Math.min(remaining, opts.limit ?? RECOMMEND_DAILY_CAP);
        const candidates = await listCandidatesForRecommendation(
          companyId,
          take,
        );
        if (candidates.length === 0) continue;

        if (!client) {
          candidates.forEach(() => fail(MISSING_KEY_ERROR));
          continue;
        }

        // Company-level context is the same for every candidate: fetched once.
        const [company, cnaes, profile, documents] = await Promise.all([
          getCompany(companyId),
          getCompanyCnaes(companyId),
          getProfile(companyId),
          listDocuments(companyId),
        ]);
        const documentKinds = [...new Set(documents.map((d) => d.kind))];

        for (const candidate of candidates) {
          try {
            const enrichment = await fetchEnrichment(candidate.procurementId);
            const prompt = buildRecommendationPrompt({
              candidate,
              enrichment,
              company,
              cnaes,
              profile,
              documentKinds,
            });

            const completion = await client.chat.completions.create({
              model: RECOMMEND_MODEL,
              messages: [
                { role: "system", content: prompt.system },
                { role: "user", content: prompt.user },
              ],
              response_format: { type: "json_object" },
            });
            const text = completion.choices?.[0]?.message?.content ?? "";
            const output = parseRecommendation(text);
            if (!output) {
              fail(
                `resposta inválida do modelo para a oportunidade ${candidate.opportunityId}`,
              );
              continue;
            }

            await insertRecommendation(candidate.opportunityId, {
              verdict: output.verdict,
              rationale: output.rationale,
              model: RECOMMEND_MODEL,
              confidence: output.confidence,
            });
            // Only after the row exists: a `recommended` opportunity with no
            // recommendation would be a card with an empty verdict.
            await setOpportunityState(
              companyId,
              candidate.opportunityId,
              "recommended",
            );
            counters.recommended += 1;
          } catch (err) {
            fail(
              `falha ao recomendar a oportunidade ${candidate.opportunityId}: ${
                err instanceof Error ? err.message : String(err)
              }`,
              err,
            );
          }
        }
      } catch (err) {
        fail(
          `falha na empresa ${companyId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
          err,
        );
      }
    }

    await finishRun(runId, "done", counters, firstError);
    return { runId, ...counters };
  } catch (err) {
    await finishRun(
      runId,
      "failed",
      counters,
      err instanceof Error ? err.message : String(err),
    );
    throw err;
  }
}
