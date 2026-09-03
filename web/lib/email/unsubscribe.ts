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

function normalize(email: string): string {
  return email.trim().toLowerCase();
}

/** Base64url HMAC-SHA256 of the normalized address, keyed by the shared
 * internal secret. Deterministic — no expiry, no stored state; anyone who
 * knows the token can unsubscribe that one address and nothing else. */
export function unsubscribeToken(email: string): string {
  return createHmac("sha256", process.env.LIXTO_INTERNAL_TOKEN ?? "")
    .update(normalize(email))
    .digest("base64url");
}

/** Constant-time comparison against the expected token. Length mismatches
 * are rejected before `timingSafeEqual` (which throws on unequal-length
 * buffers) rather than allowed to throw. */
export function verifyUnsubscribeToken(email: string, token: string): boolean {
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
