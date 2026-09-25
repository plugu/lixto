import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Relative imports (not "@/lib/...") on purpose: vitest resolves no path
// alias, mirroring app/api/internal/cases/run/route.test.ts. `runMatchBatch`
// and `invalidateTags` are mocked so this test never touches a live database
// — it only pins the route's contract: the token gate, the optional
// companyId/since, the error copy, and that the `match` cache tag drops
// after a batch.
vi.mock("../../../../../lib/match-batch", () => ({
  runMatchBatch: vi.fn(),
}));
vi.mock("../../../../../lib/cache", () => ({
  CACHE_TAGS: { sync: "sync", match: "match" },
  invalidateTags: vi.fn(),
}));

import { invalidateTags } from "../../../../../lib/cache";
import { runMatchBatch } from "../../../../../lib/match-batch";
import { POST } from "./route";

const mock = <T>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

const url = "http://localhost/api/internal/match/run";

const EMPTY = {
  runId: 1,
  scored: 0,
  matched: 0,
  attention: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.LIXTO_INTERNAL_TOKEN;
  mock(runMatchBatch).mockResolvedValue(EMPTY);
  mock(invalidateTags).mockReturnValue(0);
});

afterEach(() => {
  delete process.env.LIXTO_INTERNAL_TOKEN;
});

describe("POST /api/internal/match/run", () => {
  it("401s without the internal token", async () => {
    process.env.LIXTO_INTERNAL_TOKEN = "s3cret";

    const res = await POST(new Request(url, { method: "POST" }));

    expect(res.status).toBe(401);
    expect(runMatchBatch).not.toHaveBeenCalled();
    expect(invalidateTags).not.toHaveBeenCalled();
  });

  it("runs the batch and drops the match cache tag on success", async () => {
    process.env.LIXTO_INTERNAL_TOKEN = "s3cret";
    mock(runMatchBatch).mockResolvedValue({ ...EMPTY, runId: 9, scored: 12 });

    const res = await POST(
      new Request(url, {
        method: "POST",
        headers: { "x-lixto-internal-token": "s3cret" },
      }),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ...EMPTY, runId: 9, scored: 12 });
    expect(runMatchBatch).toHaveBeenCalledWith({ companyId: undefined, since: undefined });
    expect(invalidateTags).toHaveBeenCalledWith(["match"]);
  });

  it("passes companyId and since through to the batch", async () => {
    process.env.LIXTO_INTERNAL_TOKEN = "s3cret";

    const res = await POST(
      new Request(url, {
        method: "POST",
        headers: {
          "x-lixto-internal-token": "s3cret",
          "content-type": "application/json",
        },
        body: JSON.stringify({ companyId: 42, since: "2026-08-01T00:00:00Z" }),
      }),
    );

    expect(res.status).toBe(200);
    expect(runMatchBatch).toHaveBeenCalledWith({
      companyId: 42,
      since: new Date("2026-08-01T00:00:00Z"),
    });
    expect(invalidateTags).toHaveBeenCalledWith(["match"]);
  });

  it("400s on an invalid since and does not drop the cache tag", async () => {
    process.env.LIXTO_INTERNAL_TOKEN = "s3cret";

    const res = await POST(
      new Request(url, {
        method: "POST",
        headers: {
          "x-lixto-internal-token": "s3cret",
          "content-type": "application/json",
        },
        body: JSON.stringify({ since: "not a date" }),
      }),
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "since inválido" });
    expect(runMatchBatch).not.toHaveBeenCalled();
    expect(invalidateTags).not.toHaveBeenCalled();
  });

  it("tolerates a malformed body and still runs the global batch", async () => {
    process.env.LIXTO_INTERNAL_TOKEN = "s3cret";

    const res = await POST(
      new Request(url, {
        method: "POST",
        headers: {
          "x-lixto-internal-token": "s3cret",
          "content-type": "application/json",
        },
        body: "not json",
      }),
    );

    expect(res.status).toBe(200);
    expect(runMatchBatch).toHaveBeenCalledWith({ companyId: undefined, since: undefined });
    expect(invalidateTags).toHaveBeenCalledWith(["match"]);
  });

  it("500s, reports an error, and does not drop the cache tag when the batch throws", async () => {
    process.env.LIXTO_INTERNAL_TOKEN = "s3cret";
    mock(runMatchBatch).mockRejectedValueOnce(new Error("db gone"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await POST(
      new Request(url, {
        method: "POST",
        headers: { "x-lixto-internal-token": "s3cret" },
      }),
    );

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: "falha ao rodar o match" });
    expect(invalidateTags).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
