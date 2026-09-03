import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Relative imports (not "@/lib/...") on purpose: vitest runs with no path
// alias, mirroring how lib/email/sender.test.ts exercises the send route.
// `runDigestBatch` is mocked so this test never touches a database.
vi.mock("../../../../../lib/email/digest-batch", () => ({
  runDigestBatch: vi.fn(),
}));

import { POST } from "./route";
import { runDigestBatch } from "../../../../../lib/email/digest-batch";

const mock = <T>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

const url = "http://localhost/api/internal/email/digest";

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.LIXTO_INTERNAL_TOKEN;
  mock(runDigestBatch).mockResolvedValue({ companies: 0, enqueued: 0, skipped: 0 });
});

afterEach(() => {
  delete process.env.LIXTO_INTERNAL_TOKEN;
});

describe("POST /api/internal/email/digest", () => {
  it("401s without the internal token", async () => {
    process.env.LIXTO_INTERNAL_TOKEN = "s3cret";

    const res = await POST(new Request(url, { method: "POST" }));

    expect(res.status).toBe(401);
    expect(runDigestBatch).not.toHaveBeenCalled();
  });

  it("returns the batch counts with a valid token and an empty body", async () => {
    process.env.LIXTO_INTERNAL_TOKEN = "s3cret";
    mock(runDigestBatch).mockResolvedValue({ companies: 3, enqueued: 5, skipped: 1 });

    const res = await POST(
      new Request(url, {
        method: "POST",
        headers: { "x-lixto-internal-token": "s3cret" },
      }),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ companies: 3, enqueued: 5, skipped: 1 });
    expect(runDigestBatch).toHaveBeenCalledWith({ companyId: undefined });
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
    expect(runDigestBatch).toHaveBeenCalledWith({ companyId: 42 });
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
    expect(runDigestBatch).toHaveBeenCalledWith({ companyId: undefined });
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
    expect(runDigestBatch).toHaveBeenCalledWith({ companyId: undefined });
  });

  it("500s and reports an error when the batch throws", async () => {
    process.env.LIXTO_INTERNAL_TOKEN = "s3cret";
    mock(runDigestBatch).mockRejectedValueOnce(new Error("db gone"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await POST(
      new Request(url, {
        method: "POST",
        headers: { "x-lixto-internal-token": "s3cret" },
      }),
    );

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: "falha ao enfileirar o resumo diário" });
    spy.mockRestore();
  });
});
