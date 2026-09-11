import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  SESSION_COOKIE: "lixto_session",
  destroySession: vi.fn(async () => {}),
}));

import { GET, POST } from "./route";

describe("logout route", () => {
  it("redirects with a relative Location so the proxied host is preserved", async () => {
    // In standalone mode request.url is built from HOSTNAME:PORT
    // (http://localhost:3000/...), not from the public host behind Traefik,
    // so the handler must not derive the target from the request at all.
    const response = await POST();

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/login");
  });

  it("expires the session cookie on the response", async () => {
    const response = await GET();

    const cookie = response.cookies.get("lixto_session");
    expect(cookie?.value).toBe("");
    expect(cookie?.maxAge).toBe(0);
  });
});
