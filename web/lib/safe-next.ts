// Pure helper, no imports: shared by login/actions.ts and public-pages.ts to
// sanitise `?next=` targets before a redirect. Kept import-free so it stays
// trivially unit-testable and safe to use from both server and client code.

/** Default landing page after login / redirect-if-logged-in. */
export const DEFAULT_LANDING = "/dashboard";

/** Returns `raw` when it is safe to redirect to (same-origin, no control
 * characters), else `null`.
 *
 * Rejects:
 * - anything that doesn't start with "/" (absolute URLs, relative paths)
 * - a second character of "/" or "\" — browsers normalise both `//evil.com`
 *   and `/\evil.com` to a protocol-relative URL that leaves the origin
 * - embedded `\r`, `\n` or `\t` (header/response-splitting guard)
 * - public-only or side-effecting targets: exactly `/login` or `/logout`,
 *   or `/signup`/`/signup/...` — `next=/login?next=…` would nest one
 *   redirect hop per level, and `next=/logout` would turn a crafted login
 *   link into a logout
 */
export function safeNextPath(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (raw[0] !== "/") return null;
  if (raw[1] === "/" || raw[1] === "\\") return null;
  if (/[\r\n\t]/.test(raw)) return null;
  const pathname = raw.split(/[?#]/, 1)[0];
  if (pathname === "/login" || pathname === "/logout") return null;
  if (pathname === "/signup" || pathname.startsWith("/signup/")) return null;
  return raw;
}
