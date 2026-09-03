// Digest-unsubscribe link: an HMAC-signed token over the recipient's
// (normalized) address, verified without a DB round-trip before we call
// `suppress` (outbox.ts, ticket 108). No deps beyond `node:crypto` — this
// module is imported by the unsubscribe route (nodejs runtime) and by the
// daily-digest template builder (ticket 113) to construct the footer link.
//
// Relative imports on purpose (see digest-queries.ts): vitest runs without a
// config file, so the tsconfig "@/" alias is not resolvable from lib tests.

import { createHmac, timingSafeEqual } from "node:crypto";

const APP_URL = process.env.LIXTO_APP_URL ?? "https://lixto.com.br";

/** Dedicated key, never `LIXTO_INTERNAL_TOKEN`: this one signs a mutation that
 * a logged-out stranger can trigger, and it must not be reusable as the batch
 * routes' bearer token (nor they as this signing key). */
export const UNSUBSCRIBE_SECRET_VAR = "LIXTO_UNSUBSCRIBE_SECRET";

/** Read at call time, not at module load, so the value can be rotated (and so
 * tests can set it) without a re-import. Empty counts as unset. */
function secret(): string | null {
  const value = process.env[UNSUBSCRIBE_SECRET_VAR];
  return value ? value : null;
}

function normalize(email: string): string {
  return email.trim().toLowerCase();
}

/** Base64url HMAC-SHA256 of the normalized address, keyed by
 * `LIXTO_UNSUBSCRIBE_SECRET`. Deterministic — no expiry, no stored state;
 * anyone who knows the token can unsubscribe that one address and nothing
 * else.
 *
 * Throws when the secret is unset: an empty HMAC key would produce a token
 * that anyone can compute offline, and ADR 002 §D4 suppression is address-wide
 * (it also stops welcome/invite/reset mail). Failing to build the digest
 * footer link is strictly better than shipping a forgeable one. */
export function unsubscribeToken(email: string): string {
  const key = secret();
  if (!key) {
    throw new Error(
      `${UNSUBSCRIBE_SECRET_VAR} is not set: refusing to mint a forgeable unsubscribe token`,
    );
  }
  return createHmac("sha256", key).update(normalize(email)).digest("base64url");
}

/** Constant-time comparison against the expected token. Length mismatches
 * are rejected before `timingSafeEqual` (which throws on unequal-length
 * buffers) rather than allowed to throw. With no secret configured every
 * token is invalid — the fail-closed counterpart of `unsubscribeToken`. */
export function verifyUnsubscribeToken(email: string, token: string): boolean {
  if (!secret() || !token) return false;
  const expected = Buffer.from(unsubscribeToken(email));
  const actual = Buffer.from(token);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

/** Footer link for the daily-digest template (ticket 113). */
export function buildUnsubscribeUrl(email: string): string {
  const params = new URLSearchParams({
    email: normalize(email),
    token: unsubscribeToken(email),
  });
  return `${APP_URL}/email/unsubscribe?${params.toString()}`;
}
