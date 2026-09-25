import { beforeEach, describe, expect, it, vi } from "vitest";

// Relative imports (not "@/lib/...") on purpose: vitest runs without a
// config file. The pool is mocked — these tests never touch a live
// database. `cache` is real (no db dependency) so it exercises the actual
// memoisation these functions rely on.
vi.mock("./db", () => ({ pool: { query: vi.fn() } }));

import { invalidateTags, resetCache } from "./cache";
import { pool } from "./db";
import {
  fetchByDay,
  fetchByModality,
  fetchByPortal,
  fetchStatusCounts,
} from "./stats-queries";

const query = pool.query as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  resetCache();
  query.mockReset();
  query.mockResolvedValue({ rows: [] });
});

describe("fetchStatusCounts", () => {
  it("runs the query once for two calls, then again after the sync tag drops", async () => {
    await fetchStatusCounts();
    await fetchStatusCounts();
    expect(query).toHaveBeenCalledTimes(1);

    invalidateTags(["sync"]);
    await fetchStatusCounts();
    expect(query).toHaveBeenCalledTimes(2);
  });
});

describe("fetchByDay", () => {
  it("runs the query once for two calls, then again after the sync tag drops", async () => {
    await fetchByDay();
    await fetchByDay();
    expect(query).toHaveBeenCalledTimes(1);

    invalidateTags(["sync"]);
    await fetchByDay();
    expect(query).toHaveBeenCalledTimes(2);
  });
});

describe("fetchByModality", () => {
  it("runs the query once per scope, then again after the sync tag drops", async () => {
    await fetchByModality("open");
    await fetchByModality("open");
    expect(query).toHaveBeenCalledTimes(1);

    // A different scope is a different cache key.
    await fetchByModality("upcoming");
    expect(query).toHaveBeenCalledTimes(2);

    invalidateTags(["sync"]);
    await fetchByModality("open");
    expect(query).toHaveBeenCalledTimes(3);
  });
});

describe("fetchByPortal", () => {
  it("runs the query once for two calls, then again after the sync tag drops", async () => {
    await fetchByPortal("all");
    await fetchByPortal("all");
    expect(query).toHaveBeenCalledTimes(1);

    invalidateTags(["sync"]);
    await fetchByPortal("all");
    expect(query).toHaveBeenCalledTimes(2);
  });
});

// Note: fetchStatusCounts/fetchByModality/fetchByPortal read `open`,
// `upcoming`, and `new24h` relative to `now()`. Once cached, a value can
// drift from a fresh read for at most one TTL (LIXTO_WEB_CACHE_TTL_SECONDS,
// default 15 min) until the next sync's cache/revalidate call or the TTL
// itself expires it — accepted per PRODUCT.md.
