import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";

const ORIGIN = "https://www.lixto.com.br";

function request(path: string, session?: string): NextRequest {
  const headers = session ? { cookie: `lixto_session=${session}` } : undefined;
  return new NextRequest(`${ORIGIN}${path}`, { headers });
}

describe("proxy", () => {
  it("serves the marketing page at / to logged-out visitors", () => {
    const response = proxy(request("/"));
    expect(response.headers.get("location")).toBeNull();
  });

  it("serves the marketing page at / to logged-in visitors too", () => {
    const response = proxy(request("/", "abc"));
    expect(response.headers.get("location")).toBeNull();
  });

  it("redirects protected routes to /login without a session", () => {
    const response = proxy(request("/dashboard"));
    expect(response.headers.get("location")).toBe(
      `${ORIGIN}/login?next=%2Fdashboard`,
    );
  });

  it("lets protected routes through with a session", () => {
    const response = proxy(request("/dashboard", "abc"));
    expect(response.headers.get("location")).toBeNull();
  });
});
