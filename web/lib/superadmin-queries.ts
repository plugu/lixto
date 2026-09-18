// Superadmin recipient lookup — used to fan out the "new company pending
// approval" mail (ticket 156) to every platform superadmin. Superadmin
// itself is a per-user flag granted only by CLI (`lixto users
// grant-superadmin`); this module only reads it.
//
// Relative imports on purpose: vitest runs without a config file, so the
// tsconfig "@/" alias is not resolvable in superadmin-queries.test.ts.

import { pool } from "./db";
import type { Queryable } from "./email/outbox";

export type SqlQuery = {
  text: string;
  values: unknown[];
};

export type SuperadminRecipient = {
  id: number;
  email: string;
  name: string;
};

export function buildListSuperadminRecipients(): SqlQuery {
  return {
    text: `SELECT id, email, name FROM users WHERE is_superadmin ORDER BY id`,
    values: [],
  };
}

/** All superadmin users, ordered by id. `client` defaults to `pool` but
 * accepts a transaction client so callers (e.g. the signup hook) can read
 * inside the same transaction that just committed the new company. */
export async function listSuperadminRecipients(
  client: Queryable = pool,
): Promise<SuperadminRecipient[]> {
  const query = buildListSuperadminRecipients();
  const { rows } = await client.query<{
    id: string | number;
    email: string;
    name: string;
  }>(query.text, query.values);
  return rows.map((row) => ({
    id: Number(row.id),
    email: row.email,
    name: row.name,
  }));
}
