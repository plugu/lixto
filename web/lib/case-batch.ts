// The case agent's batch pass (PRODUCT, cycle 30): every GO recommendation
// becomes a case, every case waiting on a dossier either gets its
// habilitação verdict computed or asks for the analysis and waits, and every
// case that just turned `ready` gets one `case_ready` email per company
// admin — stamped so a rerun never sends it twice.
//
// After a case is decided `submit`, this same pass also drives its outcome:
// once its session is `RESULTS_DELAY_DAYS` (case-outcome.ts) in the past, its
// procurement's items are opened on the PNCP results demand queue
// (src/lixto/sync/results.py drains it — HTTP calls only, never LLM); once
// every item is synced, `decideOutcome` turns the evidence into `won` or
// `lost` and writes the matching `opportunity_feedback` row. The operator can
// always correct a case to `disqualified` by hand (`markDisqualifiedAction`,
// app/(app)/cases/[id]/actions.ts).
//
// Zero LLM spend: the verdict is lib/case-verdict.ts, pure code, and so is
// the outcome decision (lib/case-outcome.ts). The only thing that can cost
// tokens is `enqueueAnalysis`, which is the *existing* on-demand dossier
// queue under its own per-company daily cap.
//
// Runs inside the web process, triggered by the token-guarded internal route
// (app/api/internal/cases/run) — the CLI (`lixto cases run`) only pokes that
// route, the same shape as match/recommend.
//
// Relative imports (not "@/lib/...") on purpose: vitest runs without a path
// alias for lib tests.

import { enqueueAnalysis, fetchAnalysis } from "./analysis-queries";
import { decideOutcome } from "./case-outcome";
import {
  fetchOutcomeEvidence,
  getCompanyAdminUserId,
  getProcurementClosesAt,
  insertCase,
  insertSystemFeedback,
  listCasesAwaitingOutcome,
  listCasesForResultsRequest,
  listCasesToEmail,
  listCasesWaitingAnalysis,
  listCompanyAdminEmails,
  listGoOpportunitiesWithoutCase,
  replaceCaseChecks,
  requestItemResults,
  setOutcomeFromPncp,
  stampCaseEmailed,
  stampCaseResultsRequested,
} from "./case-queries";
import { computeChecks, resolveSessionAt } from "./case-verdict";
import { pool } from "./db";
import { listDocuments } from "./document-queries";
import { enqueue } from "./email/outbox";
import type { TemplatePayloads } from "./email/templates";

// Same fallback and env var as email/digest-batch.ts — one app URL for every
// outbound email link.
const APP_URL = process.env.LIXTO_APP_URL ?? "https://lixto.com.br";

export type CaseBatchResult = {
  runId: number;
  created: number;
  ready: number;
  waiting: number;
  emailed: number;
  resultsRequested: number;
  resolved: number;
  failed: number;
};

async function startRun(companyId: number | null): Promise<number> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO agent_runs (kind, company_id, status)
          VALUES ('cases', $1, 'running')
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
 * One pass over the case pipeline. Returns the run counters; the `agent_runs`
 * row carries the same numbers.
 *
 * Five steps, always in this order: create cases from GO recommendations,
 * compute verdicts, email the ones that just turned ready, open the PNCP
 * results queue for submitted cases whose session cleared
 * `RESULTS_DELAY_DAYS` (case-outcome.ts), and resolve the outcome of
 * submitted cases already on that queue. Steps chain within one pass — a
 * case created in step 1 can be emailed in step 3, and a case whose queue
 * step 4 just opened can already resolve in step 5 if the evidence supports
 * it (e.g. every item was synced by an earlier, unrelated run).
 *
 * A row that throws costs that row, never the run: the counter goes up, the
 * error is logged and the pass continues. Only a step-level failure (the work
 * list itself cannot be read) fails the run.
 */
export async function runCaseBatch(
  opts: { companyId?: number } = {},
): Promise<CaseBatchResult> {
  const runId = await startRun(opts.companyId ?? null);

  const counters = {
    created: 0,
    ready: 0,
    waiting: 0,
    emailed: 0,
    resultsRequested: 0,
    resolved: 0,
    failed: 0,
  };

  try {
    // 1. One case per GO recommendation that has none.
    const candidates = await listGoOpportunitiesWithoutCase(opts.companyId);
    for (const candidate of candidates) {
      try {
        const caseId = await insertCase({
          companyId: candidate.company_id,
          procurementId: candidate.procurement_id,
          opportunityId: candidate.opportunity_id,
          recommendationId: candidate.recommendation_id,
        });
        if (caseId !== null) counters.created += 1;
      } catch (err) {
        counters.failed += 1;
        console.error(
          `[case-batch] opportunity ${candidate.opportunity_id} failed`,
          err,
        );
      }
    }

    // 2. Compute the verdict for every case whose dossier is ready — the ones
    //    just created included.
    const waiting = await listCasesWaitingAnalysis(opts.companyId);
    for (const row of waiting) {
      try {
        const analysis = await fetchAnalysis(row.procurement_id);

        if (!analysis) {
          // No dossier (or a failed one): ask for it under the existing
          // per-company cap and keep waiting. A capped/closed/already-analysed
          // answer is not an error — the next pass tries again.
          const userId = await getCompanyAdminUserId(row.company_id);
          if (userId !== null) {
            await enqueueAnalysis(row.procurement_id, row.company_id, userId);
          }
          counters.waiting += 1;
          continue;
        }

        const closesAt = await getProcurementClosesAt(row.procurement_id);
        const session = resolveSessionAt(analysis.dates, closesAt);
        const documents = await listDocuments(row.company_id);
        const checks = computeChecks(
          analysis.requirements,
          documents,
          session.at,
          new Date(),
        );

        await replaceCaseChecks(row.id, checks, {
          analysisVersion: analysis.version,
          sessionAt: session.at,
          sessionSource: session.source,
        });
        counters.ready += 1;
      } catch (err) {
        counters.failed += 1;
        console.error(`[case-batch] case ${row.id} failed`, err);
      }
    }

    // 3. One `case_ready` email per admin for every case that is `ready` and
    //    has never been emailed — including the ones step 2 just computed.
    //    Stamped even when nothing was actually enqueued (no admins, or every
    //    `enqueue` came back a duplicate) so the case is never revisited.
    const toEmail = await listCasesToEmail(opts.companyId);
    for (const row of toEmail) {
      try {
        const emails = await listCompanyAdminEmails(row.company_id);
        const payload: TemplatePayloads["case_ready"] = {
          companyName: row.company_name,
          procurementTitle: row.description ?? "Licitação",
          agency: row.agency_name,
          stateUf: row.state_uf,
          sessionAt: row.session_at ? row.session_at.toISOString() : null,
          met: row.met,
          expiring: row.expiring,
          missing: row.missing,
          manual: row.manual,
          caseUrl: `${APP_URL}/cases/${row.id}`,
        };

        for (const email of emails) {
          const result = await enqueue({
            toEmail: email,
            template: "case_ready",
            payload,
            companyId: row.company_id,
            dedupeKey: `case_ready:${row.id}:${email}`,
          });
          if (result.id !== null) counters.emailed += 1;
        }

        await stampCaseEmailed(row.id);
      } catch (err) {
        counters.failed += 1;
        console.error(`[case-batch] case ${row.id} email failed`, err);
      }
    }

    // 4. Every submitted case whose session cleared RESULTS_DELAY_DAYS
    //    (case-outcome.ts) gets its procurement's items opened on the PNCP
    //    results demand queue (src/lixto/sync/results.py drains it) — once
    //    per case, ever (stamped so a rerun never re-requests it).
    const toRequest = await listCasesForResultsRequest();
    for (const row of toRequest) {
      try {
        await requestItemResults(row.procurement_id);
        await stampCaseResultsRequested(row.id);
        counters.resultsRequested += 1;
      } catch (err) {
        counters.failed += 1;
        console.error(
          `[case-batch] case ${row.id} results request failed`,
          err,
        );
      }
    }

    // 5. Every submitted, requested, still-unresolved case is checked
    //    against whatever `procurement_results` knows so far. `decideOutcome`
    //    (case-outcome.ts) only resolves on full evidence — a case is never
    //    written on a partial answer, so most rows here simply keep waiting.
    const awaitingOutcome = await listCasesAwaitingOutcome();
    for (const row of awaitingOutcome) {
      try {
        const evidence = await fetchOutcomeEvidence(row.id);
        const outcome = decideOutcome(evidence);
        if (outcome !== null) {
          await setOutcomeFromPncp(row.id, outcome);
          await insertSystemFeedback(row.opportunity_id, outcome, "pncp:results");
          counters.resolved += 1;
        }
      } catch (err) {
        counters.failed += 1;
        console.error(`[case-batch] case ${row.id} outcome failed`, err);
      }
    }

    await finishRun(runId, "done", counters);
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
