// SQL builder for the ⌘K command palette (ticket 149): a keyword-only,
// top-N lookup of procurements by free text.
//
// Deliberately NOT registered in lib/tenant-isolation.test.ts: procurements
// are public data (ADR 001 — they are ingested globally and reused by every
// company), so this builder takes no `company_id` and there is no tenant
// boundary to assert. The session is still required by the server action
// that calls it (app/(app)/search/actions.ts).
//
// Relative imports (not "@/lib/...") on purpose: vitest runs without a config
// file, so the tsconfig "@/" alias is not resolvable from lib tests.

import { pool } from "./db";
import { ACTIVE_PORTALS } from "./portals";

export type SqlQuery = {
  text: string;
  values: unknown[];
};

export type CommandSearchRow = {
  source_id: string;
  description: string | null;
  agency_name: string | null;
  state: string | null;
  proposal_closes_at: Date | null;
};

/** Rows the palette shows under "Licitações". */
export const COMMAND_SEARCH_LIMIT = 8;

/** Below this many characters the palette does not hit the database. */
export const COMMAND_SEARCH_MIN_CHARS = 2;

/** The same FTS expression `fetchProcurements` uses (lib/procurement-queries.ts,
 * `buildQPredicate`): unaccented on both sides (migration 001) so "limpeza"
 * matches "Limpeza" and "lapis" matches "lápis". Qualified with the table name
 * because the palette query joins `agencies`. No item-level OR and no
 * embeddings here — the palette must answer in one index scan. */
const TSVECTOR = `to_tsvector('portuguese', f_unaccent(coalesce(procurements.description, '')))`;

function tsquery(idx: number): string {
  return `websearch_to_tsquery('portuguese', f_unaccent($${idx}))`;
}

/** Top `limit` procurements matching `q`, ranked by `ts_rank` then by closing
 * date (latest deadline first — an open tender beats a long-closed one).
 * `$1` is the platform portal allowlist, `$2` the query text, `$3` the limit;
 * every outside value is bound, never interpolated. */
export function buildCommandSearchQuery(
  q: string,
  limit: number = COMMAND_SEARCH_LIMIT,
): SqlQuery {
  const rank = `ts_rank(${TSVECTOR}, ${tsquery(2)})`;

  const text = `
    SELECT
      procurements.source_id,
      procurements.description,
      agencies.name AS agency_name,
      procurements.state,
      procurements.proposal_closes_at
    FROM procurements
    JOIN agencies ON agencies.tax_id = procurements.agency_tax_id
    WHERE procurements.origin_system = ANY($1)
      AND ${TSVECTOR} @@ ${tsquery(2)}
    ORDER BY ${rank} DESC,
             procurements.proposal_closes_at DESC NULLS LAST,
             procurements.source_id
    LIMIT $3
  `;

  return { text, values: [ACTIVE_PORTALS, q, limit] };
}

/** Thin wrapper for the palette server action. */
export async function searchProcurementsForPalette(
  q: string,
): Promise<CommandSearchRow[]> {
  const query = buildCommandSearchQuery(q);
  const { rows } = await pool.query<CommandSearchRow>(query.text, query.values);
  return rows;
}
