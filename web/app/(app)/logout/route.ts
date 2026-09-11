import { NextResponse } from "next/server";
import { SESSION_COOKIE, destroySession } from "@/lib/auth";

async function handle() {
  await destroySession();
  // A relative Location on purpose. In standalone mode request.url is built
  // from HOSTNAME:PORT (http://localhost:3000/...), not from the public host
  // Traefik forwarded, so `new URL("/login", request.url)` would send the
  // browser to the container's internal address. The browser resolves a
  // relative Location against the page it posted from, which is always right.
  const response = new NextResponse(null, {
    status: 303, // POST -> GET on the redirect target
    headers: { Location: "/login" },
  });
  // Belt and braces: cookies() mutations are not always carried over onto a
  // NextResponse we build ourselves, so expire it on the response too.
  response.cookies.set(SESSION_COOKIE, "", {
    path: "/",
    maxAge: 0,
    expires: new Date(0),
  });
  return response;
}

export async function POST() {
  return handle();
}

// GET too, so a plain link works as a fallback.
export async function GET() {
  return handle();
}
