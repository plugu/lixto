// The batch half of the match engine (PRODUCT §1): every company with a
// profile or CNAEs is scored against the procurements enriched since the last
// run, and the results are persisted as `matches` + `opportunities`.
//
// One scoring implementation: this reuses `fetchMatches` (and through it
// `scoreCandidate`), the very code the chat calls on demand. Nothing is
// re-derived here — the batch only decides *what* to score, *when*, and *what
// to write*.
//
// Runs inside the web process, triggered by the token-guarded internal route
// (app/api/internal/match/run) — the CLI (ticket 92) only pokes that route.
//
// Relative imports (not "@/lib/...") on purpose: vitest runs without a config
// file, so the tsconfig "@/" alias is not resolvable from lib tests.

import { pool } from "./db";
import { MATCH_ENGINE_VERSION } from "./match-engine";
import { fetchMatches } from "./match-queries";
import {
  ATTENTION_SCORE,
  MATCH_SCORE,
  getLastRun,
  insertMatch,
  setOpportunityState,
  upsertOpportunity,
} from "./opportunity-queries";

/** First run: everything ever enriched is fair game. */
const EPOCH = new Date(0);

/** Rows the SQL side hands to the scorer per company. Higher than the
 * interactive default (200): a batch pass is allowed to be slower. */
const BATCH_CANDIDATE_LIMIT = 500;

/** Scored rows kept per company. Above the candidate cap on purpose — the cap
 * is the real limit, this just means "don't truncate". */
const PER_COMPANY_LIMIT = 1000;

export type MatchBatchResult = {
  runId: number;
  companies: number;
  scored: number;
  matched: number;
  attention: number;
};

async function listCompanies(): Promise<number[]> {
  // A company with neither a profile nor CNAEs has nothing to match on: the
  // scorer would return `no_profile` for every row.
  const { rows } = await pool.query<{ id: string }>(
    `SELECT c.id
       FROM companies c
      WHERE EXISTS (SELECT 1 FROM company_profiles p WHERE p.company_id = c.id)
         OR EXISTS (SELECT 1 FROM company_cnaes cc WHERE cc.company_id = c.id)
      ORDER BY c.id`,
  );
  return rows.map((r) => Number(r.id));
}

/** `fetchMatches` speaks `source_id` (the public identifier); `matches` and
 * `opportunities` are keyed by the internal id. One bound lookup per company
 * instead of one per row. */
async function procurementIds(
  sourceIds: string[],
): Promise<Map<string, number>> {
  if (sourceIds.length === 0) return new Map();
  const { rows } = await pool.query<{ id: string; source_id: string }>(
    `SELECT id, source_id FROM procurements WHERE source_id = ANY($1::text[])`,
    [sourceIds],
  );
  return new Map(rows.map((r) => [r.source_id, Number(r.id)]));
}

async function startRun(companyId: number | null): Promise<number> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO agent_runs (kind, company_id, status)
          VALUES ('match', $1, 'running')
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

/**
 * Scores and persists. Returns the run counters; the `agent_runs` row carries
 * the same numbers plus `failed` (companies whose scoring threw).
 *
 * The watermark is read *before* the run row is inserted — otherwise the last
 * `match` run would be this one. Only a `done` run is a valid watermark: after
 * a failure we rescan from the epoch rather than silently skip a window
 * (rescanning is safe — opportunities are unique per pair).
 */
export async function runMatchBatch(
  opts: { companyId?: number; since?: Date; candidateLimit?: number } = {},
): Promise<MatchBatchResult> {
  const lastRun = await getLastRun("match");
  const since =
    opts.since ??
    (lastRun && lastRun.status === "done" ? lastRun.started_at : EPOCH);

  const runId = await startRun(opts.companyId ?? null);

  const counters = {
    companies: 0,
    scored: 0,
    matched: 0,
    attention: 0,
    failed: 0,
  };

  try {
    const companies =
      opts.companyId !== undefined ? [opts.companyId] : await listCompanies();
    counters.companies = companies.length;

    for (const companyId of companies) {
      try {
        const rows = await fetchMatches(
          companyId,
          { statuses: ["open", "upcoming"], enrichedSince: since },
          PER_COMPANY_LIMIT,
          opts.candidateLimit ?? BATCH_CANDIDATE_LIMIT,
        );
        counters.scored += rows.length;

        const keep = rows.filter((row) => row.score >= MATCH_SCORE);
        const ids = await procurementIds(keep.map((row) => row.source_id));

        for (const row of keep) {
          const procurementId = ids.get(row.source_id);
          // Deleted between the scan and now, or a source_id the lookup can't
          // resolve: skip it rather than fail the company.
          if (procurementId === undefined) continue;

          await insertMatch(
            companyId,
            procurementId,
            row.score,
            row.reasons,
            MATCH_ENGINE_VERSION,
          );
          const opportunity = await upsertOpportunity(companyId, procurementId);
          // Fresh rows land on the `discovered` default and move straight to
          // `matched`; an existing row keeps whatever state it reached
          // (`dismissed` stays dismissed).
          if (opportunity.created) {
            await setOpportunityState(companyId, opportunity.id, "matched");
          }
          counters.matched += 1;
          if (row.score >= ATTENTION_SCORE) counters.attention += 1;
        }
      } catch (err) {
        // One broken company (bad profile vector, missing enrichment, …) must
        // never cost the other companies their run.
        counters.failed += 1;
        console.error(`[match-batch] company ${companyId} failed`, err);
      }
    }

    await finishRun(runId, "done", counters);
    return {
      runId,
      companies: counters.companies,
      scored: counters.scored,
      matched: counters.matched,
      attention: counters.attention,
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
