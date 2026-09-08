// SQL for the cached AI analysis on /radar/[id] (ticket 129):
// `future_opportunity_analyses` (company_id, future_opportunity_id, model,
// content JSONB, UNIQUE pair), created in migration 005 (ticket 124).
//
// Relative imports (not "@/lib/...") on purpose: vitest runs without a config
// file, so the tsconfig "@/" alias is not resolvable from lib tests.

import { pool } from "./db";
import type { RadarAnalysis } from "./radar-analysis";

export type AnalysisRow = {
  content: RadarAnalysis;
  model: string;
  created_at: Date | string;
};

/** This company's cached analysis for one opportunity, if any. Scoped to
 * `company_id` — the tenant golden rule (docs/TENANT.md). */
export async function getAnalysis(
  companyId: number,
  id: number,
): Promise<AnalysisRow | null> {
  const { rows } = await pool.query<AnalysisRow>(
    `SELECT content, model, created_at
       FROM future_opportunity_analyses
      WHERE company_id = $1 AND future_opportunity_id = $2`,
    [companyId, id],
  );
  return rows[0] ?? null;
}

/** Inserts the analysis, then re-reads it. `ON CONFLICT DO NOTHING` so a
 * race between two requests never errors — whichever insert wins, both
 * callers read the same cached row back. */
export async function insertAnalysis(
  companyId: number,
  id: number,
  model: string,
  content: RadarAnalysis,
): Promise<AnalysisRow> {
  await pool.query(
    `INSERT INTO future_opportunity_analyses (company_id, future_opportunity_id, model, content)
          VALUES ($1, $2, $3, $4::jsonb)
     ON CONFLICT (company_id, future_opportunity_id) DO NOTHING`,
    [companyId, id, model, JSON.stringify(content)],
  );
  const row = await getAnalysis(companyId, id);
  if (!row) {
    throw new Error(
      `failed to read back the analysis for opportunity ${id} (company ${companyId})`,
    );
  }
  return row;
}

/** Analyses this company has generated today, for the daily cap. Bound to
 * `$1` only — the day boundary is a literal SQL expression, not a parameter,
 * per the ticket. */
export async function countAnalysesToday(companyId: number): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count
       FROM future_opportunity_analyses
      WHERE company_id = $1
        AND created_at >= date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo')`,
    [companyId],
  );
  return Number(rows[0]?.count ?? 0);
}
