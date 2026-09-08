// Candidate retrieval + persistence for the Radar company-match score
// (ticket 126). Modelled on web/lib/match-queries.ts: pure builders gather
// facts and scoring happens in TS (radar-engine.ts's `scoreCompanyMatch`);
// thin async wrappers do the actual I/O. `companyId` is always $1 — never
// string-interpolated into SQL (docs/TENANT.md).
//
// Relative imports (not "@/lib/...") on purpose: vitest runs without a config
// file, so the tsconfig "@/" alias is not resolvable from lib tests.

import { pool } from "./db";
import type { ProfileSummary, Reason } from "./match-engine";
import { buildTermsTsQuery } from "./match-queries";
import {
  getProfile,
  getProfileEmbeddingText,
  type SqlQuery,
} from "./profile-queries";
import { RADAR_MATCH_ENGINE_VERSION } from "./radar-engine";

/** The company side of a radar match: profile (may be absent) + size + the
 * profile vector — same three loads as `match-queries.ts`'s
 * `loadProfileSummary` (getProfile, companies.size, the profile embedding). */
export type RadarProfile = ProfileSummary & {
  exclusion_terms: string[];
  embedding: string | null;
};

/** Row shape `buildRadarCandidateQuery` returns, before scoring. */
export type RadarCandidateRow = {
  id: string;
  state: string | null;
  estimated_value: string | null;
  text_hit: boolean | null;
  exclusion_hit: boolean | null;
  /** pg returns numeric expressions as strings unless a type parser says
   * otherwise; normalized with Number() before scoring. */
  similarity: string | number | null;
};

/** Rows the pgvector nearest-neighbour scan contributes as candidates. */
const SEMANTIC_TOP_K = 500;

/** Minimum cosine similarity that counts as a signal on its own — same floor
 * as the weakest band in radar-engine.ts. */
const SEMANTIC_MIN = 0.4;

/** How many candidate opportunities the SQL side hands to the scorer per
 * company. Scoring is cheap; the DB scan is not. */
const CANDIDATE_LIMIT = 500;

/**
 * The candidate statement for one company: every `predicted` future
 * opportunity that either FTS-matches the profile terms or lands in the
 * pgvector top-K for the profile embedding. `companyId` is bound as $1 for
 * tenant-isolation consistency, even though the SQL body does not otherwise
 * need it (there is no per-company table to join here — the profile facts
 * arrive already loaded).
 */
export function buildRadarCandidateQuery(
  companyId: number,
  profile: RadarProfile,
  candidateLimit: number = CANDIDATE_LIMIT,
): SqlQuery {
  const values: unknown[] = [companyId];
  const bind = (value: unknown): string => {
    values.push(value);
    return `$${values.length}`;
  };

  const tqParam = bind(buildTermsTsQuery(profile.terms));
  const exclusionTqParam = bind(buildTermsTsQuery(profile.exclusion_terms));

  // A NULL tsquery would make the whole comparison NULL; the CASE keeps it a
  // plain false so the "at least one signal" predicate stays sargable.
  const ftsHit = (param: string) => `(CASE WHEN ${param}::text IS NULL THEN false ELSE (
        to_tsvector('portuguese', f_unaccent(coalesce(fo.title, '')))
          @@ to_tsquery('portuguese', f_unaccent(${param}::text))
      ) END)`;

  const textHit = ftsHit(tqParam);
  const exclusionHit = ftsHit(exclusionTqParam);

  // Semantic top-K: bound as text — node-pg has no vector type — and the CTE
  // is skipped entirely when the profile has no embedding yet (same trick as
  // match-queries.ts:187).
  const profileEmbedding = profile.embedding;
  const semanticCte = profileEmbedding
    ? (() => {
        const v = bind(profileEmbedding);
        return `,
    s AS (
      SELECT fo2.id AS future_opportunity_id,
             1 - (e.embedding <=> ${v}::vector) AS similarity
        FROM plan_item_embeddings e
        JOIN future_opportunities fo2
          ON (fo2.plan_id, fo2.item_number) = (e.plan_id, e.item_number)
       ORDER BY e.embedding <=> ${v}::vector
       LIMIT ${SEMANTIC_TOP_K}
    )`;
      })()
    : "";
  const semanticJoin = profileEmbedding
    ? `\n    LEFT JOIN s ON s.future_opportunity_id = fo.id`
    : "";
  const similaritySelect = profileEmbedding
    ? "s.similarity"
    : "NULL::real AS similarity";

  const conditions = [`fo.status = 'predicted'`];
  conditions.push(
    `(${textHit}${
      profileEmbedding ? `\n      OR s.similarity >= ${SEMANTIC_MIN.toFixed(2)}` : ""
    })`,
  );

  const limitParam = bind(candidateLimit);

  const text = `
    WITH company AS (SELECT $1::bigint AS company_id)${semanticCte}
    SELECT
      fo.id,
      fo.state,
      fo.estimated_value,
      ${textHit} AS text_hit,
      ${exclusionHit} AS exclusion_hit,
      ${similaritySelect}
    FROM future_opportunities fo${semanticJoin}
    WHERE ${conditions.join("\n      AND ")}
    ORDER BY fo.id
    LIMIT ${limitParam}
  `;

  return { text, values };
}

/** The company side of a radar match: same three loads as
 * `match-queries.ts`'s `loadProfileSummary` (getProfile, companies.size, the
 * profile embedding). No profile row → empty terms/states, open bounds — a
 * freshly signed-up company simply scores nothing above `no_profile`. */
export async function loadRadarProfile(companyId: number): Promise<RadarProfile> {
  const [profile, sizeResult, embedding] = await Promise.all([
    getProfile(companyId),
    pool.query<{ size: string | null }>(
      `SELECT size FROM companies WHERE id = $1`,
      [companyId],
    ),
    getProfileEmbeddingText(companyId),
  ]);
  return {
    terms: profile?.terms ?? [],
    exclusion_terms: profile?.exclusion_terms ?? [],
    states: profile?.states ?? [],
    min_value: profile?.min_value ?? null,
    max_value: profile?.max_value ?? null,
    size: sizeResult.rows[0]?.size ?? null,
    embedding,
  };
}

/** One scored row as `upsertRadarMatches`/`buildUpsertRadarMatchesQuery`
 * expect it — `id` is `future_opportunities.id`. */
export type RadarMatchRow = { id: number; score: number; reasons: Reason[] };

/**
 * Multi-row upsert of the scored, kept (score >= RADAR_MATCH_MIN) rows for
 * one company. Latest state, not history — a rerun overwrites (ADR: unlike
 * `matches`, the radar list only ever shows now). `companyId` is always $1.
 * Caller must not pass an empty `rows` (the wrapper below no-ops instead —
 * an empty `VALUES ()` is invalid SQL).
 */
export function buildUpsertRadarMatchesQuery(
  companyId: number,
  rows: RadarMatchRow[],
): SqlQuery {
  const values: unknown[] = [companyId];
  const tuples: string[] = [];

  rows.forEach((row) => {
    const idParam = `$${values.push(row.id)}::bigint`;
    const scoreParam = `$${values.push(row.score)}::int`;
    const reasonsParam = `$${values.push(JSON.stringify(row.reasons))}::jsonb`;
    tuples.push(
      `($1, ${idParam}, ${scoreParam}, ${reasonsParam}, '${RADAR_MATCH_ENGINE_VERSION}')`,
    );
  });

  const text = `
    INSERT INTO future_opportunity_matches
      (company_id, future_opportunity_id, match_score, reasons, engine_version)
    VALUES ${tuples.join(", ")}
    ON CONFLICT (company_id, future_opportunity_id) DO UPDATE
       SET match_score    = EXCLUDED.match_score,
           reasons        = EXCLUDED.reasons,
           engine_version = EXCLUDED.engine_version,
           computed_at    = now()
  `;
  return { text, values };
}

/** Thin wrapper around `buildUpsertRadarMatchesQuery`. No-op on an empty
 * list — nothing scored high enough this pass. */
export async function upsertRadarMatches(
  companyId: number,
  rows: RadarMatchRow[],
): Promise<void> {
  if (rows.length === 0) return;
  const { text, values } = buildUpsertRadarMatchesQuery(companyId, rows);
  await pool.query(text, values);
}

/**
 * Deletes this company's stale matches: an opportunity no longer `predicted`,
 * or one that scored below `RADAR_MATCH_MIN` (or vanished) on this pass. The
 * kept ids are passed as `$2::bigint[]` — an empty array still binds cleanly
 * (`= ANY('{}')` is simply always false). `companyId` is always $1.
 */
export function buildPruneRadarMatchesQuery(
  companyId: number,
  keepIds: number[],
): SqlQuery {
  const text = `
    DELETE FROM future_opportunity_matches m
     WHERE m.company_id = $1
       AND (
         NOT EXISTS (
           SELECT 1 FROM future_opportunities fo
            WHERE fo.id = m.future_opportunity_id AND fo.status = 'predicted'
         )
         OR NOT (m.future_opportunity_id = ANY($2::bigint[]))
       )
  `;
  return { text, values: [companyId, keepIds] };
}

/** Thin wrapper around `buildPruneRadarMatchesQuery`. Returns the number of
 * rows deleted. */
export async function pruneRadarMatches(
  companyId: number,
  keepIds: number[],
): Promise<number> {
  const { text, values } = buildPruneRadarMatchesQuery(companyId, keepIds);
  const { rowCount } = await pool.query(text, values);
  return rowCount ?? 0;
}

/** Every company with a profile row — the universe the batch scores. A
 * company with no profile yet has nothing to match on (CNAE is not a radar
 * signal, per PRODUCT.md). */
export async function listCompaniesWithProfile(): Promise<number[]> {
  const { rows } = await pool.query<{ company_id: string }>(
    `SELECT company_id FROM company_profiles ORDER BY company_id`,
  );
  return rows.map((r) => Number(r.company_id));
}
