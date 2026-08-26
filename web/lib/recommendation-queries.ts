// Persistence for the bounded GO/NO-GO pass (PRODUCT §2, ADR 001 §D5): the
// `recommendations` table plus the two reads the batch needs — how many
// recommendations a company already got today (the hard daily cap) and which
// opportunities still deserve one.
//
// Relative imports (not "@/lib/...") on purpose: vitest runs without a config
// file, so the tsconfig "@/" alias is not resolvable from lib tests.
//
// Tenant rule (docs/TENANT.md): `companyId` is always bound into the WHERE
// clause — `insertRecommendation` is the one exception and takes an
// opportunity id that only ever comes from `listCandidatesForRecommendation`,
// which is company-scoped.

import { pool } from "./db";
import type { Reason } from "./match-engine";
import { ATTENTION_SCORE } from "./opportunity-queries";

export type Verdict = "go" | "no_go" | "borderline";

export type RecommendationInput = {
  verdict: Verdict;
  rationale: string;
  model: string | null;
  confidence: number | null;
};

/** One opportunity worth spending a Tier-3 call on, with the procurement
 * facts the prompt needs (no extra round trip per candidate). */
export type RecommendationCandidate = {
  opportunityId: number;
  procurementId: number;
  sourceId: string;
  score: number;
  reasons: Reason[];
  description: string | null;
  agency_name: string | null;
  /** `procurements.state` (UF) — renamed so it cannot be read as a lifecycle
   * state. */
  state_uf: string | null;
  city_name: string | null;
  modality_name: string | null;
  estimated_value: string | null;
  proposal_closes_at: Date | null;
};

type CandidateDbRow = Omit<
  RecommendationCandidate,
  "opportunityId" | "procurementId" | "sourceId" | "score"
> & {
  id: string;
  procurement_id: string;
  source_id: string;
  score: number | string;
};

export async function insertRecommendation(
  opportunityId: number,
  input: RecommendationInput,
): Promise<void> {
  await pool.query(
    `INSERT INTO recommendations (opportunity_id, verdict, rationale, model, confidence)
          VALUES ($1, $2, $3, $4, $5)`,
    [
      opportunityId,
      input.verdict,
      input.rationale,
      input.model,
      input.confidence,
    ],
  );
}

/** How many recommendations this company already received since midnight —
 * the batch subtracts it from `RECOMMEND_DAILY_CAP`. Counted in SQL (the join
 * to `opportunities` is what makes it per company). */
export async function countRecommendationsToday(
  companyId: number,
): Promise<number> {
  const { rows } = await pool.query<{ count: string | number }>(
    `SELECT count(*) AS count
       FROM recommendations r
       JOIN opportunities o ON o.id = r.opportunity_id
      WHERE o.company_id = $1
        AND r.created_at >= date_trunc('day', now())`,
    [companyId],
  );
  return Number(rows[0]?.count ?? 0);
}

/**
 * The company's opportunities that still `matched`, whose newest score is at
 * or above the attention line, and that carry no recommendation yet — best
 * score first, then the ones closing soonest. `NOT EXISTS` is what makes the
 * batch idempotent: a rerun on the same day never re-recommends.
 */
export async function listCandidatesForRecommendation(
  companyId: number,
  limit: number,
): Promise<RecommendationCandidate[]> {
  const { rows } = await pool.query<CandidateDbRow>(
    `WITH latest_match AS (
       SELECT DISTINCT ON (company_id, procurement_id)
              company_id, procurement_id, score, reasons, computed_at
         FROM matches
        WHERE company_id = $1
        ORDER BY company_id, procurement_id, computed_at DESC
     )
     SELECT o.id,
            o.procurement_id,
            p.source_id,
            m.score,
            coalesce(m.reasons, '[]'::jsonb) AS reasons,
            p.description,
            a.name AS agency_name,
            p.state AS state_uf,
            p.city_name,
            p.modality_name,
            p.estimated_value,
            p.proposal_closes_at
       FROM opportunities o
       JOIN procurements p ON p.id = o.procurement_id
       JOIN latest_match m
         ON m.company_id = o.company_id AND m.procurement_id = o.procurement_id
       LEFT JOIN agencies a ON a.tax_id = p.agency_tax_id
      WHERE o.company_id = $1
        AND o.state = 'matched'
        AND m.score >= ${ATTENTION_SCORE}
        AND NOT EXISTS (
              SELECT 1 FROM recommendations r WHERE r.opportunity_id = o.id
            )
      ORDER BY m.score DESC, p.proposal_closes_at ASC NULLS LAST
      LIMIT $2`,
    [companyId, limit],
  );
  return rows.map((row) => ({
    opportunityId: Number(row.id),
    procurementId: Number(row.procurement_id),
    sourceId: row.source_id,
    score: Number(row.score),
    reasons: row.reasons ?? [],
    description: row.description,
    agency_name: row.agency_name,
    state_uf: row.state_uf,
    city_name: row.city_name,
    modality_name: row.modality_name,
    estimated_value: row.estimated_value,
    proposal_closes_at: row.proposal_closes_at,
  }));
}

/** Companies with at least one opportunity still waiting for a verdict. The
 * batch loops over these instead of over every company: a company with no
 * `matched` opportunity has nothing to recommend. */
export async function listCompaniesWithCandidates(): Promise<number[]> {
  const { rows } = await pool.query<{ company_id: string }>(
    `SELECT DISTINCT o.company_id
       FROM opportunities o
      WHERE o.state = 'matched'
      ORDER BY o.company_id`,
  );
  return rows.map((row) => Number(row.company_id));
}
