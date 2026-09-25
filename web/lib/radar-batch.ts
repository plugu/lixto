// The batch half of the Radar (PRODUCT.md, cycle 24): every PCA item inside
// the horizon becomes a scored `future_opportunities` row, and rows whose item
// vanished or whose estimated date has passed are expired.
//
// Global, not per company: one opportunity = one PCA item, scored once for
// everyone ("process once, reuse globally"). The per-company match score
// (ticket 126) lives in `future_opportunity_matches` and runs after detection
// and expiry, so `status = 'predicted'` is final when candidates are read —
// see the loop at the end of `runRadarBatch`.
//
// Runs inside the web process, triggered by the token-guarded internal route
// (app/api/internal/radar/run) — the CLI (ticket 125) only pokes that route.
//
// Relative imports (not "@/lib/...") on purpose: vitest.config.ts defines no
// resolve alias, so the tsconfig "@/" alias is not resolvable from lib tests.

import { pool } from "./db";
import type { Reason } from "./match-engine";
import {
  RADAR_ENGINE_VERSION,
  RADAR_MATCH_MIN,
  loadWeights,
  scoreCompanyMatch,
  scoreOpportunity,
  type RadarCandidateFacts,
  type Signal,
} from "./radar-engine";
import {
  buildRadarCandidateQuery,
  listCompaniesWithProfile,
  loadRadarProfile,
  pruneRadarMatches,
  upsertRadarMatches,
  type RadarCandidateRow,
} from "./radar-match-queries";

/** Items are read in keyset pages of this size — the horizon can be hundreds
 * of thousands of rows nationwide, and OFFSET paging degrades on every page. */
const PAGE_SIZE = 500;

/** Items whose desired date is further out than this are not opportunities
 * yet. Overridable with `LIXTO_RADAR_HORIZON_DAYS`. */
const DEFAULT_HORIZON_DAYS = 365;

export type RadarBatchResult = {
  runId: number;
  /** Rows written to `future_opportunities` this run — i.e. the upsert's
   * summed `rowCount` (see `upsertPage`), not the count of horizon rows
   * scanned. A row whose tracked columns are unchanged since the last run
   * is skipped by the `IS DISTINCT FROM` guard and does not add to this
   * total. */
  opportunities: number;
  expired: number;
  companies: number;
  matched: number;
};

/** One PCA item as the horizon query returns it. `pg` hands NUMERIC and DATE
 * back as strings; they are bound straight back into the upsert, so no
 * precision is lost in a JS number. */
type HorizonRow = {
  plan_id: string;
  item_number: number;
  agency_tax_id: string;
  state: string | null;
  title: string;
  pdm_code: string | null;
  category_name: string | null;
  estimated_value: string | null;
  expected_date: string | null;
  plan_year: number;
  plan_updated_at: string | null;
};

export function horizonDays(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = env.LIXTO_RADAR_HORIZON_DAYS;
  if (raw === undefined || raw.trim() === "") return DEFAULT_HORIZON_DAYS;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_HORIZON_DAYS;
  return Math.floor(value);
}

// The item's state comes from the plan's own unit when we have it; otherwise
// from the agency's most common unit state (agencies are almost always
// single-state, and a NULL here would hide the row from every state filter).
const HORIZON_SQL = `
  SELECT p.id                       AS plan_id,
         i.item_number              AS item_number,
         p.agency_tax_id            AS agency_tax_id,
         coalesce(
           u.state,
           (SELECT au.state
              FROM agency_units au
             WHERE au.agency_tax_id = p.agency_tax_id AND au.state IS NOT NULL
             GROUP BY au.state
             ORDER BY count(*) DESC, au.state
             LIMIT 1)
         )                          AS state,
         i.description              AS title,
         i.pdm_code                 AS pdm_code,
         i.category_name            AS category_name,
         i.total_value              AS estimated_value,
         i.desired_date             AS expected_date,
         p.year                     AS plan_year,
         p.source_global_updated_at AS plan_updated_at
    FROM procurement_plan_items i
    JOIN procurement_plans p ON p.id = i.plan_id
    LEFT JOIN agency_units u
      ON u.agency_tax_id = p.agency_tax_id AND u.code = p.unit_code
   WHERE p.year >= extract(year FROM current_date)
     AND (i.desired_date IS NULL
          OR (i.desired_date >= current_date
              AND i.desired_date <= current_date + $1::int))
     AND coalesce(i.description, '') <> ''
     AND (p.id, i.item_number) > ($2::bigint, $3::int)
   ORDER BY p.id, i.item_number
   LIMIT ${PAGE_SIZE}
`;

/** Columns written per row, in bind order. */
const UPSERT_COLUMNS = 13;

// `detected_at` is never rewritten: it is the evidence that we saw the
// purchase before the notice existed. `status` only moves back to 'predicted'
// from 'expired' — a row the V2 linker set to 'procurement_found' stays put.
const UPSERT_HEAD = `
  INSERT INTO future_opportunities
    (plan_id, item_number, agency_tax_id, state, title, pdm_code, category_name,
     estimated_value, expected_date, plan_year, opportunity_score, signals, engine_version)
  VALUES `;

// The WHERE guard below skips the rewrite (and the `updated_at` bump) when
// nothing tracked actually changed, so an unchanged horizon row is not
// touched every run. The `status = 'expired'` branch is kept regardless —
// that's the resurrection path, and it must still fire even when every other
// column is byte-for-byte the same as last time.
const UPSERT_TAIL = `
  ON CONFLICT (plan_id, item_number) DO UPDATE
     SET agency_tax_id     = EXCLUDED.agency_tax_id,
         state             = EXCLUDED.state,
         title             = EXCLUDED.title,
         pdm_code          = EXCLUDED.pdm_code,
         category_name     = EXCLUDED.category_name,
         estimated_value   = EXCLUDED.estimated_value,
         expected_date     = EXCLUDED.expected_date,
         plan_year         = EXCLUDED.plan_year,
         opportunity_score = EXCLUDED.opportunity_score,
         signals           = EXCLUDED.signals,
         engine_version    = EXCLUDED.engine_version,
         status            = CASE WHEN future_opportunities.status = 'expired'
                                  THEN 'predicted'
                                  ELSE future_opportunities.status END,
         updated_at        = now()
   WHERE future_opportunities.status = 'expired'
      OR (future_opportunities.agency_tax_id, future_opportunities.state,
          future_opportunities.title, future_opportunities.pdm_code,
          future_opportunities.category_name, future_opportunities.estimated_value,
          future_opportunities.expected_date, future_opportunities.plan_year,
          future_opportunities.opportunity_score, future_opportunities.signals,
          future_opportunities.engine_version)
         IS DISTINCT FROM
         (EXCLUDED.agency_tax_id, EXCLUDED.state, EXCLUDED.title, EXCLUDED.pdm_code,
          EXCLUDED.category_name, EXCLUDED.estimated_value, EXCLUDED.expected_date,
          EXCLUDED.plan_year, EXCLUDED.opportunity_score, EXCLUDED.signals,
          EXCLUDED.engine_version)
`;

// Note the outer alias `f`: an unqualified `plan_id` inside the EXISTS would
// bind to the *inner* `procurement_plan_items`, making the predicate a
// tautology and expiring nothing.
const EXPIRE_SQL = `
  UPDATE future_opportunities f
     SET status = 'expired', updated_at = now()
   WHERE f.status = 'predicted'
     AND (f.expected_date < current_date
          OR NOT EXISTS (SELECT 1
                           FROM procurement_plan_items i
                          WHERE i.plan_id = f.plan_id
                            AND i.item_number = f.item_number))
`;

async function startRun(companyId: number | null): Promise<number> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO agent_runs (kind, company_id, status)
          VALUES ('radar', $1, 'running')
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

/** Multi-row upsert for one page. Returns how many rows were written — i.e.
 * the upsert's `rowCount`, not `rows.length`: the `WHERE ... IS DISTINCT
 * FROM ...` guard on `UPSERT_TAIL` means a row whose tracked columns are
 * unchanged from last run is skipped (no rewrite, no `updated_at` bump), so
 * `rowCount` can be smaller than the page size. Falls back to `rows.length`
 * if the driver doesn't report a count. */
async function upsertPage(
  rows: HorizonRow[],
  scored: { score: number; signals: Signal[] }[],
): Promise<number> {
  const values: unknown[] = [];
  const tuples: string[] = [];

  rows.forEach((row, index) => {
    const base = index * UPSERT_COLUMNS;
    tuples.push(
      `($${base + 1}::bigint, $${base + 2}::int, $${base + 3}, $${base + 4}, $${base + 5},` +
        ` $${base + 6}, $${base + 7}, $${base + 8}::numeric, $${base + 9}::date,` +
        ` $${base + 10}::int, $${base + 11}::int, $${base + 12}::jsonb, $${base + 13})`,
    );
    values.push(
      row.plan_id,
      row.item_number,
      row.agency_tax_id,
      row.state,
      row.title,
      row.pdm_code,
      row.category_name,
      row.estimated_value,
      row.expected_date,
      row.plan_year,
      scored[index].score,
      JSON.stringify(scored[index].signals),
      RADAR_ENGINE_VERSION,
    );
  });

  const result = await pool.query(UPSERT_HEAD + tuples.join(", ") + UPSERT_TAIL, values);
  return result.rowCount ?? rows.length;
}

/** pg hands numeric expressions back as strings; anything unparseable (or
 * absent) means "no semantic signal". */
function toSimilarity(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Scores and persists one company's `future_opportunity_matches`. Returns
 * how many rows scored >= RADAR_MATCH_MIN and were kept. */
async function matchCompany(companyId: number): Promise<number> {
  const profile = await loadRadarProfile(companyId);
  const query = buildRadarCandidateQuery(companyId, profile);
  const { rows } = await pool.query<RadarCandidateRow>(query.text, query.values);

  const scored = rows.map((row) => {
    const facts: RadarCandidateFacts = {
      id: Number(row.id),
      state: row.state,
      estimated_value: row.estimated_value,
      text_hit: row.text_hit === true,
      exclusion_hit: row.exclusion_hit === true,
      similarity: toSimilarity(row.similarity),
    };
    const { score, reasons } = scoreCompanyMatch(facts, profile);
    return { id: facts.id, score, reasons };
  });

  const keep = scored.filter(
    (row): row is { id: number; score: number; reasons: Reason[] } =>
      row.score >= RADAR_MATCH_MIN,
  );

  await upsertRadarMatches(companyId, keep);
  await pruneRadarMatches(
    companyId,
    keep.map((row) => row.id),
  );

  return keep.length;
}

/**
 * Detects future opportunities from the PCA horizon, expires stale ones, then
 * scores each company profile against the surviving `predicted` rows
 * (ticket 126). Detection and expiry stay global — one opportunity, scored
 * once for everyone; the match pass loops one company (`opts.companyId`) or
 * every company with a profile row.
 *
 * A single company's match pass failing (bad profile vector, a DB hiccup)
 * never costs the others their run — counted in `failed`, and the first such
 * error is recorded on `agent_runs.error` even though the run still finishes
 * `done` (same policy as match-batch.ts's per-company try/catch).
 */
export async function runRadarBatch(
  opts: { companyId?: number } = {},
): Promise<RadarBatchResult> {
  const runId = await startRun(opts.companyId ?? null);

  const counters = {
    items: 0,
    opportunities: 0,
    expired: 0,
    pages: 0,
    companies: 0,
    matched: 0,
    failed: 0,
  };

  try {
    const days = horizonDays();
    const weights = loadWeights();
    const now = new Date();

    // Keyset cursor: (plan_id, item_number) of the last row of the last page.
    let cursorPlanId = "0";
    let cursorItemNumber = -1;

    for (;;) {
      const { rows } = await pool.query<HorizonRow>(HORIZON_SQL, [
        days,
        cursorPlanId,
        cursorItemNumber,
      ]);
      if (rows.length === 0) break;

      counters.pages += 1;
      counters.items += rows.length;

      const scored = rows.map((row) =>
        scoreOpportunity(
          {
            expected_date: row.expected_date,
            plan_updated_at: row.plan_updated_at,
          },
          now,
          weights,
        ),
      );
      counters.opportunities += await upsertPage(rows, scored);

      const last = rows[rows.length - 1];
      cursorPlanId = String(last.plan_id);
      cursorItemNumber = last.item_number;

      if (rows.length < PAGE_SIZE) break;
    }

    const expired = await pool.query(EXPIRE_SQL);
    counters.expired = expired.rowCount ?? 0;

    // Company match pass — after expiry, so `status = 'predicted'` is final
    // when candidates are read.
    const companies =
      opts.companyId !== undefined
        ? [opts.companyId]
        : await listCompaniesWithProfile();
    counters.companies = companies.length;

    let firstError: string | null = null;
    for (const companyId of companies) {
      try {
        counters.matched += await matchCompany(companyId);
      } catch (err) {
        counters.failed += 1;
        const message = err instanceof Error ? err.message : String(err);
        firstError ??= message;
        console.error(`[radar-batch] company ${companyId} failed`, err);
      }
    }

    await finishRun(runId, "done", counters, firstError);
    return {
      runId,
      opportunities: counters.opportunities,
      expired: counters.expired,
      companies: counters.companies,
      matched: counters.matched,
    };
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
