import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Relative imports (not "@/lib/...") on purpose: vitest resolves no path
// alias, mirroring app/api/internal/cases/run/route.test.ts. `invalidateTags`
// is mocked so this test only pins the route's contract: the token gate, the
// default/explicit tags, and the unknown-tag rejection.
vi.mock("../../../../../lib/cache", () => ({
  CACHE_TAGS: { sync: "sync", match: "match" },
  invalidateTags: vi.fn(),
}));

import { invalidateTags } from "../../../../../lib/cache";
import { POST } from "./route";

const mock = <T>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

const url = "http://localhost/api/internal/cache/revalidate";

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.LIXTO_INTERNAL_TOKEN;
  mock(invalidateTags).mockReturnValue(0);
});

afterEach(() => {
  delete process.env.LIXTO_INTERNAL_TOKEN;
});

describe("POST /api/internal/cache/revalidate", () => {
  it("401s without the internal token", async () => {
    const res = await POST(new Request(url, { method: "POST" }));

    expect(res.status).toBe(401);
    expect(invalidateTags).not.toHaveBeenCalled();
  });

  it("defaults to the sync tag with an empty body", async () => {
    process.env.LIXTO_INTERNAL_TOKEN = "s3cret";
    mock(invalidateTags).mockReturnValue(3);

    const res = await POST(
      new Request(url, {
        method: "POST",
        headers: { "x-lixto-internal-token": "s3cret" },
      }),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ revalidated: ["sync"], dropped: 3 });
    expect(invalidateTags).toHaveBeenCalledWith(["sync"]);
  });

  it("drops the explicit tags given in the body", async () => {
    process.env.LIXTO_INTERNAL_TOKEN = "s3cret";
    mock(invalidateTags).mockReturnValue(1);

    const res = await POST(
      new Request(url, {
        method: "POST",
        headers: {
          "x-lixto-internal-token": "s3cret",
          "content-type": "application/json",
        },
        body: JSON.stringify({ tags: ["match"] }),
      }),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ revalidated: ["match"], dropped: 1 });
    expect(invalidateTags).toHaveBeenCalledWith(["match"]);
  });

  it("400s on an unknown tag", async () => {
    process.env.LIXTO_INTERNAL_TOKEN = "s3cret";

    const res = await POST(
      new Request(url, {
        method: "POST",
        headers: {
          "x-lixto-internal-token": "s3cret",
          "content-type": "application/json",
        },
        body: JSON.stringify({ tags: ["bogus"] }),
      }),
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "tag inválida" });
    expect(invalidateTags).not.toHaveBeenCalled();
  });
});
