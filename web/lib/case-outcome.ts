// The case agent's outcome decision (PRODUCT, cycle 30): once a submitted
// case's items have been opened on the PNCP results demand queue
// (src/lixto/sync/results.py, `procurement_items.results_requested_at`),
// decide whether the case is won, lost, or still unresolved. Pure and
// side-effect free on purpose: the database read (case-queries.ts
// `fetchOutcomeEvidence`) and write (`setOutcomeFromPncp`) live elsewhere, so
// this truth table is exhaustively unit-testable and costs nothing to run.
//
// Relative imports (not "@/lib/...") on purpose, matching case-verdict.ts:
// this file is plain code, safe to import from a lib test without vitest's
// "@/" alias.

/**
 * Days after `cases.session_at` before a case's items are worth requesting
 * from PNCP. mvp: hardcoded — results appear days after the session;
 * requesting any earlier only burns PNCP calls for an answer that isn't
 * published yet.
 */
export const RESULTS_DELAY_DAYS = 2;

/** What `case-queries.ts`'s `fetchOutcomeEvidence` reads out of
 * `procurement_results` for one case: whether the company's own tax id is a
 * (non-cancelled) winner on any item, how many of the procurement's items
 * are still unsynced, and how many result rows exist at all. */
export type OutcomeEvidence = {
  won: boolean;
  unsyncedItems: number;
  resultRows: number;
};

/**
 * `won` beats everything else: one winning item is enough, however many
 * items are still unsynced. Otherwise the case can only be declared `lost`
 * once every item of the procurement has been synced (`unsyncedItems === 0`)
 * *and* at least one result row actually landed (`resultRows > 0`) — a case
 * must never be resolved on partial evidence, so any other combination
 * (still syncing, or fully synced with nothing published yet) returns
 * `null`, meaning "keep waiting".
 */
export function decideOutcome(
  evidence: OutcomeEvidence,
): "won" | "lost" | null {
  if (evidence.won) return "won";
  if (evidence.unsyncedItems === 0 && evidence.resultRows > 0) return "lost";
  return null;
}
