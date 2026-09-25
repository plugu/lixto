// The in-app daily digest (ticket 93): what `/lixto`, `/opportunities` and
// `/dashboard` all read to answer "what did Lixto find since the last run".
//
// Relative imports (not "@/lib/...") on purpose: vitest runs without a config
// file, so the tsconfig "@/" alias is not resolvable from lib tests.

import { CACHE_TAGS, cached } from "./cache";
import {
  ATTENTION_SCORE,
  getLastRun,
  listOpportunities,
  type OpportunityRow,
} from "./opportunity-queries";

/** Generous cap for the "how many since the last run" counts — not a page
 * size. A single company's per-run yield never gets close to this (the batch
 * caps recommendations at 5/day and matching itself is bounded by
 * BATCH_CANDIDATE_LIMIT), so this is "don't truncate", not a real limit. */
const COUNT_LIMIT = 1000;

/** Cards shown on the digest itself — `/opportunities` has the full list. */
const ATTENTION_PREVIEW_LIMIT = 5;

export type Digest = {
  run: {
    started_at: Date;
    finished_at: Date | null;
    counters: Record<string, number>;
  } | null;
  /** Procurements the last global match run scored, whatever the outcome. */
  newCount: number;
  /** This company's opportunities the run touched, state matched/recommended. */
  matchedCount: number;
  /** Of those, the ones scoring ≥ `ATTENTION_SCORE`. */
  attentionCount: number;
  /** Up to `ATTENTION_PREVIEW_LIMIT` attention-worthy opportunities, newest
   * score first — what the banner/lixto/dashboard actually render. */
  attention: OpportunityRow[];
};

/**
 * `run` is the last *global* `match` run (`company_id IS NULL` — one run
 * scores every company). Counts are scoped to `companyId` and to opportunities
 * whose newest match landed at/after that run's `started_at`, so a company
 * with no fresh matches this run reports zeros even though older opportunities
 * exist.
 */
export async function getDigest(companyId: number): Promise<Digest> {
  // Memoised under CACHE_TAGS.match (PRODUCT cycle 31): the last global match
  // run only changes when the match batch runs, which drops this tag itself
  // (app/api/internal/match/run/route.ts). `getLastRun` itself stays
  // uncached — match-batch.ts uses it as the batch watermark.
  const run = await cached("digest:last-match-run", { tags: [CACHE_TAGS.match] }, () =>
    getLastRun("match"),
  );

  if (!run) {
    return { run: null, newCount: 0, matchedCount: 0, attentionCount: 0, attention: [] };
  }

  const [matched, attention] = await Promise.all([
    listOpportunities(companyId, {
      states: ["matched", "recommended"],
      sinceRunAt: run.started_at,
      limit: COUNT_LIMIT,
    }),
    listOpportunities(companyId, {
      states: ["matched", "recommended"],
      minScore: ATTENTION_SCORE,
      sinceRunAt: run.started_at,
      limit: ATTENTION_PREVIEW_LIMIT,
    }),
  ]);

  return {
    run: {
      started_at: run.started_at,
      finished_at: run.finished_at,
      counters: run.counters,
    },
    newCount: run.counters.scored ?? 0,
    matchedCount: matched.length,
    // `matched` already carries every row the run touched for this company
    // (uncapped), so counting `.attention` here is exact — no second,
    // uncapped query needed just for the number.
    attentionCount: matched.filter((o) => o.attention).length,
    attention,
  };
}
