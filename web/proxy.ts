// Route guard (Next 16 renamed middleware.ts -> proxy.ts).
// Cheap check only: is the session cookie present? Real validation (DB lookup,
// expiry) happens in requireSession() inside pages/actions, since the proxy
// runs on the Edge-ish runtime where the pg pool is not available.

import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "plic_session";

const PUBLIC_PREFIXES = [
  "/login",
  "/signup",
  "/convite",
  "/_next",
  "/favicon.ico",
];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname === "/") {
    const url = request.nextUrl.clone();
    url.pathname = "/painel";
    return NextResponse.redirect(url);
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
