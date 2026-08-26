// Shared-secret guard for the internal routes (app/api/internal/**): the batch
// jobs the CLI triggers, never anything a browser session reaches. No cookie,
// no user — just a token both sides hold.
//
// Relative imports (not "@/lib/...") on purpose: vitest runs without a config
// file, so the tsconfig "@/" alias is not resolvable from lib tests.

import { timingSafeEqual } from "node:crypto";

export const INTERNAL_TOKEN_HEADER = "x-lixto-internal-token";

/**
 * True only when the request carries exactly `LIXTO_INTERNAL_TOKEN`. An unset
 * env var means the internal routes are closed (a missing secret must never
 * become "everything is allowed"). Compared in constant time; lengths are
 * compared first because `timingSafeEqual` throws on a mismatch, and the
 * length of a token is not the secret.
 */
export function isInternalRequest(req: Request): boolean {
  const expected = process.env.LIXTO_INTERNAL_TOKEN;
  if (!expected) return false;

  const provided = req.headers.get(INTERNAL_TOKEN_HEADER);
  if (!provided) return false;

  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
