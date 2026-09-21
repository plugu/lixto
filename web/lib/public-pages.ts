// Server-only helpers for pages that must render differently for a logged-in
// visitor (login, signup) but must never 500 when the DB is unreachable —
// public pages stay up even if auth is down; visitors just see the logged-out
// view.

import { redirect, unstable_rethrow } from "next/navigation";
import { getSession, type Session } from "./auth";
import { DEFAULT_LANDING, safeNextPath } from "./safe-next";

/** `getSession()`, treating any failure (DB outage, etc.) as logged out.
 *
 * `getSession()` → `cookies()` can throw Next's internal control-flow
 * signals (`DynamicServerError` during the prerender pass of `next build`,
 * a postpone signal under PPR, or a rethrown `redirect`/`notFound`) rather
 * than a real error. `unstable_rethrow` recognises those and rethrows them
 * unchanged so Next can handle them; only a genuine failure (DB outage,
 * etc.) falls through to the log-and-treat-as-logged-out path below.
 */
export async function getOptionalSession(): Promise<Session | null> {
  try {
    return await getSession();
  } catch (err) {
    unstable_rethrow(err);
    console.error(
      "[public-pages] session lookup failed; treating as logged out",
      err,
    );
    return null;
  }
}

/** Redirects a logged-in visitor away from a public-only page (login,
 * signup). No-op when there is no valid session.
 *
 * The `redirect()` call sits outside the try/catch inside
 * `getOptionalSession` — it throws `NEXT_REDIRECT`, which must propagate.
 */
export async function redirectIfLoggedIn(next?: string): Promise<void> {
  const session = await getOptionalSession();
  if (session) redirect(safeNextPath(next) ?? DEFAULT_LANDING);
}
