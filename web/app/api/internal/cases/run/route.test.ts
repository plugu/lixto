import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Relative imports (not "@/lib/...") on purpose: vitest resolves no path
// alias, mirroring app/api/internal/email/digest/route.test.ts. `runCaseBatch`
// is mocked so this test never touches a database — it only pins the route's
// contract: the token gate, the optional companyId, and the error copy.
vi.mock("../../../../../lib/case-batch", () => ({
  runCaseBatch: vi.fn(),
}));

import { runCaseBatch } from "../../../../../lib/case-batch";
import { POST } from "./route";

const mock = <T>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

const url = "http://localhost/api/internal/cases/run";

const EMPTY = {
  runId: 1,
  created: 0,
  ready: 0,
  waiting: 0,
  emailed: 0,
  resultsRequested: 0,
  resolved: 0,
  failed: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.LIXTO_INTERNAL_TOKEN;
  mock(runCaseBatch).mockResolvedValue(EMPTY);
});

afterEach(() => {
  delete process.env.LIXTO_INTERNAL_TOKEN;
});

describe("POST /api/internal/cases/run", () => {
  it("401s without the internal token", async () => {
    process.env.LIXTO_INTERNAL_TOKEN = "s3cret";

    const res = await POST(new Request(url, { method: "POST" }));

    expect(res.status).toBe(401);
    expect(runCaseBatch).not.toHaveBeenCalled();
  });

  it("returns the batch counters with a valid token and an empty body", async () => {
    process.env.LIXTO_INTERNAL_TOKEN = "s3cret";
    mock(runCaseBatch).mockResolvedValue({
      ...EMPTY,
      runId: 9,
      created: 2,
      ready: 1,
      waiting: 1,
    });

    const res = await POST(
      new Request(url, {
        method: "POST",
        headers: { "x-lixto-internal-token": "s3cret" },
      }),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ...EMPTY,
      runId: 9,
      created: 2,
      ready: 1,
      waiting: 1,
    });
    expect(runCaseBatch).toHaveBeenCalledWith({ companyId: undefined });
  });

  it("passes companyId through to the batch", async () => {
    process.env.LIXTO_INTERNAL_TOKEN = "s3cret";

    const res = await POST(
      new Request(url, {
        method: "POST",
        headers: {
          "x-lixto-internal-token": "s3cret",
          "content-type": "application/json",
        },
        body: JSON.stringify({ companyId: 42 }),
      }),
    );

    expect(res.status).toBe(200);
    expect(runCaseBatch).toHaveBeenCalledWith({ companyId: 42 });
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
    expect(runCaseBatch).toHaveBeenCalledWith({ companyId: undefined });
  });

  it("ignores a non-numeric companyId rather than passing it through", async () => {
    process.env.LIXTO_INTERNAL_TOKEN = "s3cret";

    const res = await POST(
      new Request(url, {
        method: "POST",
        headers: {
          "x-lixto-internal-token": "s3cret",
          "content-type": "application/json",
        },
        body: JSON.stringify({ companyId: "42" }),
      }),
    );

    expect(res.status).toBe(200);
    expect(runCaseBatch).toHaveBeenCalledWith({ companyId: undefined });
  });

  it("500s and reports an error when the batch throws", async () => {
    process.env.LIXTO_INTERNAL_TOKEN = "s3cret";
    mock(runCaseBatch).mockRejectedValueOnce(new Error("db gone"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await POST(
      new Request(url, {
        method: "POST",
        headers: { "x-lixto-internal-token": "s3cret" },
      }),
    );

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({
      error: "falha ao rodar os casos",
    });
    spy.mockRestore();
  });
});
