// Persistence for the proactive agent loop (ADR 001 §D5): `matches` (score
// history), `opportunities` (per company × procurement lifecycle),
// `opportunity_feedback` and the `agent_runs` lookup the batch needs.
//
// Relative imports (not "@/lib/...") on purpose: vitest runs without a config
// file, so the tsconfig "@/" alias is not resolvable from lib tests.
//
// Tenant rule (docs/TENANT.md): `companyId` always comes from the session (or,
// for the batch, from the company loop) and is always bound — every statement
// here carries it in the WHERE clause instead of trusting the caller to have
// checked ownership in JS.

import { pool } from "./db";
import type { Reason } from "./match-engine";

/** Score at or above which an opportunity "deserves attention" (PRODUCT §1). */
export const ATTENTION_SCORE = 70;

/** Below this the batch does not create an opportunity at all. */
export const MATCH_SCORE = 40;

export type OpportunityState =
  | "discovered"
  | "matched"
  | "analyzed"
  | "recommended"
  | "preparing"
  | "awaiting_approval"
  | "executed"
  | "dismissed";

export type OpportunityRow = {
  id: number;
  company_id: number;
  procurement_id: number;
  source_id: string;
  state: OpportunityState;
  score: number;
  reasons: Reason[];
  attention: boolean;
  computed_at: Date;
  description: string | null;
  agency_name: string | null;
  /** `procurements.state` (UF), renamed so it cannot be confused with the
   * lifecycle `state` above. */
  state_uf: string | null;
  city_name: string | null;
  modality_name: string | null;
  estimated_value: string | null;
  proposal_closes_at: Date | null;
  /** Latest recommendation for this opportunity, when ticket 91 wrote one. */
  verdict: "go" | "no_go" | "borderline" | null;
  rationale: string | null;
};

/** BIGSERIAL/BIGINT come back from node-pg as strings; the app talks numbers. */
type OpportunityDbRow = Omit<
  OpportunityRow,
  "id" | "company_id" | "procurement_id" | "score"
> & {
  id: string;
  company_id: string;
  procurement_id: string;
  score: number | string;
};

function toOpportunity(row: OpportunityDbRow): OpportunityRow {
  return {
    ...row,
    id: Number(row.id),
    company_id: Number(row.company_id),
    procurement_id: Number(row.procurement_id),
    score: Number(row.score),
    reasons: row.reasons ?? [],
  };
}

/** One row of score history. Reruns append: `matches` is a log, the current
 * score of a pair is its newest row (see `listOpportunities`). */
export async function insertMatch(
  companyId: number,
  procurementId: number,
  score: number,
  reasons: Reason[],
  engineVersion: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO matches (company_id, procurement_id, score, reasons, engine_version)
          VALUES ($1, $2, $3, $4::jsonb, $5)`,
    // JSONB: node-pg would send a JS array as a Postgres array literal.
    [companyId, procurementId, score, JSON.stringify(reasons), engineVersion],
  );
}

/**
 * The opportunity for one company × procurement. New rows start at the
 * `discovered` default; an existing row only gets its `updated_at` touched —
 * the state is never regressed, so a `dismissed` or `executed` opportunity
 * survives every rerun. `created` tells the caller which of the two happened
 * (`xmax = 0` is true only for the freshly inserted tuple).
 */
export async function upsertOpportunity(
  companyId: number,
  procurementId: number,
): Promise<{ id: number; created: boolean }> {
  const { rows } = await pool.query<{ id: string; created: boolean }>(
    `INSERT INTO opportunities (company_id, procurement_id)
          VALUES ($1, $2)
     ON CONFLICT (company_id, procurement_id)
     DO UPDATE SET updated_at = now()
       RETURNING id, (xmax = 0) AS created`,
    [companyId, procurementId],
  );
  return { id: Number(rows[0].id), created: rows[0].created === true };
}

const OPPORTUNITY_SELECT = `
  SELECT o.id,
         o.company_id,
         o.procurement_id,
         p.source_id,
         o.state,
         coalesce(m.score, 0) AS score,
         coalesce(m.reasons, '[]'::jsonb) AS reasons,
         (coalesce(m.score, 0) >= ${ATTENTION_SCORE}) AS attention,
         coalesce(m.computed_at, o.created_at) AS computed_at,
         p.description,
         a.name AS agency_name,
         p.state AS state_uf,
         p.city_name,
         p.modality_name,
         p.estimated_value,
         p.proposal_closes_at,
         r.verdict,
         r.rationale
    FROM opportunities o
    JOIN procurements p ON p.id = o.procurement_id
    LEFT JOIN agencies a ON a.tax_id = p.agency_tax_id
    LEFT JOIN latest_match m
      ON m.company_id = o.company_id AND m.procurement_id = o.procurement_id
    LEFT JOIN LATERAL (
      SELECT rec.verdict, rec.rationale
        FROM recommendations rec
       WHERE rec.opportunity_id = o.id
       ORDER BY rec.created_at DESC, rec.id DESC
       LIMIT 1
    ) r ON true`;

/** Newest `matches` row per pair, for this company only ($1). */
const LATEST_MATCH_CTE = `
  WITH latest_match AS (
    SELECT DISTINCT ON (company_id, procurement_id)
           company_id, procurement_id, score, reasons, computed_at
      FROM matches
     WHERE company_id = $1
     ORDER BY company_id, procurement_id, computed_at DESC
  )`;

export async function listOpportunities(
  companyId: number,
  opts: {
    states?: OpportunityState[];
    minScore?: number;
    limit?: number;
    /** Only what this run produced: the newest match is at/after this instant. */
    sinceRunAt?: Date;
  } = {},
): Promise<OpportunityRow[]> {
  const values: unknown[] = [companyId];
  const bind = (value: unknown): string => `$${values.push(value)}`;

  const conditions = [`o.company_id = $1`];
  if (opts.states && opts.states.length > 0) {
    conditions.push(`o.state = ANY(${bind(opts.states)})`);
  }
  if (opts.minScore !== undefined) {
    conditions.push(`coalesce(m.score, 0) >= ${bind(opts.minScore)}`);
  }
  if (opts.sinceRunAt) {
    conditions.push(
      `coalesce(m.computed_at, o.created_at) >= ${bind(opts.sinceRunAt)}`,
    );
  }

  const text = `${LATEST_MATCH_CTE}${OPPORTUNITY_SELECT}
   WHERE ${conditions.join("\n     AND ")}
   ORDER BY coalesce(m.score, 0) DESC, p.proposal_closes_at ASC NULLS LAST
   LIMIT ${bind(opts.limit ?? 50)}`;

  const { rows } = await pool.query<OpportunityDbRow>(text, values);
  return rows.map(toOpportunity);
}

/** One opportunity by the public `procurements.source_id`. Null unless it
 * belongs to `companyId` — both values are bound. */
export async function getOpportunity(
  companyId: number,
  sourceId: string,
): Promise<OpportunityRow | null> {
  const { rows } = await pool.query<OpportunityDbRow>(
    `${LATEST_MATCH_CTE}${OPPORTUNITY_SELECT}
      WHERE o.company_id = $1 AND p.source_id = $2
      LIMIT 1`,
    [companyId, sourceId],
  );
  return rows[0] ? toOpportunity(rows[0]) : null;
}

export async function setOpportunityState(
  companyId: number,
  opportunityId: number,
  state: OpportunityState,
): Promise<void> {
  await pool.query(
    `UPDATE opportunities
        SET state = $3, updated_at = now()
      WHERE id = $2 AND company_id = $1`,
    [companyId, opportunityId, state],
  );
}

/** Writes the learning-loop row. The INSERT ... SELECT verifies ownership in
 * the same statement: an opportunity of another company selects zero rows and
 * nothing is written. */
export async function insertFeedback(
  companyId: number,
  opportunityId: number,
  userId: number,
  kind: "accepted" | "rejected",
  reason: string | null,
): Promise<void> {
  await pool.query(
    `INSERT INTO opportunity_feedback (opportunity_id, user_id, kind, reason)
          SELECT o.id, $3, $4, $5
            FROM opportunities o
           WHERE o.id = $2 AND o.company_id = $1`,
    [companyId, opportunityId, userId, kind, reason],
  );
}

export type AgentRun = {
  id: number;
  started_at: Date;
  finished_at: Date | null;
  counters: Record<string, number>;
  status: string;
};

/** The newest `agent_runs` row of a kind, whatever its status — callers decide
 * what a `running`/`failed` one means (the batch treats anything but `done` as
 * "no watermark" and rescans). Omitting `companyId` means the global run
 * (`company_id IS NULL`), not "any company". */
export async function getLastRun(
  kind: string,
  companyId?: number,
): Promise<AgentRun | null> {
  const { rows } = await pool.query<Omit<AgentRun, "id"> & { id: string }>(
    `SELECT id, started_at, finished_at, counters, status
       FROM agent_runs
      WHERE kind = $1
        AND ${companyId === undefined ? "company_id IS NULL" : "company_id = $2"}
      ORDER BY started_at DESC, id DESC
      LIMIT 1`,
    companyId === undefined ? [kind] : [kind, companyId],
  );
  const row = rows[0];
  return row ? { ...row, id: Number(row.id), counters: row.counters ?? {} } : null;
}
