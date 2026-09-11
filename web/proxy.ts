// Route guard (Next 16 renamed middleware.ts -> proxy.ts).
// Cheap check only: is the session cookie present? Real validation (DB lookup,
// expiry) happens in requireSession() inside pages/actions, since the proxy
// runs on the Edge-ish runtime where the pg pool is not available.

import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "lixto_session";

const PUBLIC_PREFIXES = [
  "/login",
  "/signup",
  "/invite",
  "/_next",
  "/favicon.ico",
  // Internal batch routes authenticate with LIXTO_INTERNAL_TOKEN, not a session.
  "/api/internal",
  // The digest footer link is followed from an inbox, with no session and no
  // way to obtain one; it authenticates with its own HMAC token
  // (lib/email/unsubscribe.ts). Redirecting it to /login would also drop
  // ?email=&token= on the `url.search = ""` below.
  "/email/unsubscribe",
];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // `/` is the public marketing page for everyone, logged in or not.
  if (pathname === "/") {
    return NextResponse.next();
  }

  if (PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return NextResponse.next();
  }

  // An empty value counts as absent: that's what logout leaves behind.
  if (!request.cookies.get(SESSION_COOKIE)?.value) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
