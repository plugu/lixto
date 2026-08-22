import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, destroySession } from "@/lib/auth";

async function handle(request: NextRequest) {
  await destroySession();
  const response = NextResponse.redirect(new URL("/login", request.url), {
    status: 303, // POST -> GET on the redirect target
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

export async function POST(request: NextRequest) {
  return handle(request);
}

// GET too, so a plain link works as a fallback.
export async function GET(request: NextRequest) {
  return handle(request);
}
