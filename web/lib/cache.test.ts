import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CACHE_TAGS,
  cached,
  invalidateTags,
  resetCache,
  stableKey,
} from "./cache";

beforeEach(() => {
  resetCache();
  delete process.env.LIXTO_WEB_CACHE_TTL_SECONDS;
  delete process.env.LIXTO_WEB_CACHE_MAX_ENTRIES;
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.LIXTO_WEB_CACHE_TTL_SECONDS;
  delete process.env.LIXTO_WEB_CACHE_MAX_ENTRIES;
});

describe("cached", () => {
  it("does not store a load that was invalidated while in flight", async () => {
    let resolveLoad: (value: string) => void = () => {};
    const slow = vi.fn(
      () => new Promise<string>((resolve) => { resolveLoad = resolve; }),
    );
    const fresh = vi.fn().mockResolvedValue("post-sync");

    const pending = cached("k", { tags: ["sync"] }, slow);
    expect(invalidateTags(["sync"])).toBe(1);
    resolveLoad("pre-sync");

    expect(await pending).toBe("pre-sync");
    expect(await cached("k", { tags: ["sync"] }, fresh)).toBe("post-sync");
    expect(fresh).toHaveBeenCalledTimes(1);
  });

  it("misses once then hits from the store", async () => {
    const load = vi.fn().mockResolvedValue("value");

    const first = await cached("k", { tags: ["sync"] }, load);
    const second = await cached("k", { tags: ["sync"] }, load);

    expect(first).toBe("value");
    expect(second).toBe("value");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("reloads after the TTL expires", async () => {
    vi.useFakeTimers();
    process.env.LIXTO_WEB_CACHE_TTL_SECONDS = "10";
    const load = vi.fn().mockResolvedValueOnce("first").mockResolvedValueOnce("second");

    const first = await cached("k", { tags: ["sync"] }, load);
    vi.advanceTimersByTime(10_001);
    const second = await cached("k", { tags: ["sync"] }, load);

    expect(first).toBe("first");
    expect(second).toBe("second");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("uses ttlMs from opts over the env default when given", async () => {
    vi.useFakeTimers();
    const load = vi.fn().mockResolvedValueOnce("first").mockResolvedValueOnce("second");

    await cached("k", { tags: ["sync"], ttlMs: 5_000 }, load);
    vi.advanceTimersByTime(5_001);
    const second = await cached("k", { tags: ["sync"], ttlMs: 5_000 }, load);

    expect(second).toBe("second");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("single-flights concurrent misses into one load call", async () => {
    let resolveLoad!: (value: string) => void;
    const load = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveLoad = resolve;
        }),
    );

    const first = cached("k", { tags: ["sync"] }, load);
    const second = cached("k", { tags: ["sync"] }, load);
    resolveLoad("shared");

    await expect(first).resolves.toBe("shared");
    await expect(second).resolves.toBe("shared");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("does not store a rejected load and propagates the rejection", async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error("boom"));

    await expect(cached("k", { tags: ["sync"] }, load)).rejects.toThrow("boom");

    const retry = vi.fn().mockResolvedValue("ok");
    await expect(cached("k", { tags: ["sync"] }, retry)).resolves.toBe("ok");
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("propagates a rejection to every concurrent caller", async () => {
    let rejectLoad!: (err: Error) => void;
    const load = vi.fn(
      () =>
        new Promise<string>((_resolve, reject) => {
          rejectLoad = reject;
        }),
    );

    const first = cached("k", { tags: ["sync"] }, load);
    const second = cached("k", { tags: ["sync"] }, load);
    rejectLoad(new Error("boom"));

    await expect(first).rejects.toThrow("boom");
    await expect(second).rejects.toThrow("boom");
    expect(load).toHaveBeenCalledTimes(1);
  });
});

describe("invalidateTags", () => {
  it("drops only entries carrying the given tag", async () => {
    await cached("sync-key", { tags: [CACHE_TAGS.sync] }, () => Promise.resolve("s"));
    await cached("match-key", { tags: [CACHE_TAGS.match] }, () => Promise.resolve("m"));

    const dropped = invalidateTags([CACHE_TAGS.sync]);

    expect(dropped).toBe(1);

    const syncLoad = vi.fn().mockResolvedValue("s2");
    const matchLoad = vi.fn().mockResolvedValue("m2");
    await cached("sync-key", { tags: [CACHE_TAGS.sync] }, syncLoad);
    await cached("match-key", { tags: [CACHE_TAGS.match] }, matchLoad);

    expect(syncLoad).toHaveBeenCalledTimes(1);
    expect(matchLoad).not.toHaveBeenCalled();
  });

  it("drops an in-flight load carrying the tag", async () => {
    let resolveLoad!: (value: string) => void;
    const load = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveLoad = resolve;
        }),
    );

    const pending = cached("k", { tags: [CACHE_TAGS.sync] }, load);
    const dropped = invalidateTags([CACHE_TAGS.sync]);
    resolveLoad("value");
    await pending;

    expect(dropped).toBe(1);
  });
});

describe("max entries eviction", () => {
  it("evicts the oldest inserted entry once the bound is reached", async () => {
    process.env.LIXTO_WEB_CACHE_MAX_ENTRIES = "2";

    // a, b fill the store; c is a third insert so a (the oldest) is evicted.
    await cached("a", { tags: ["sync"] }, () => Promise.resolve("a"));
    await cached("b", { tags: ["sync"] }, () => Promise.resolve("b"));
    await cached("c", { tags: ["sync"] }, () => Promise.resolve("c"));

    const reloadB = vi.fn().mockResolvedValue("b2");
    const reloadC = vi.fn().mockResolvedValue("c2");
    const reloadA = vi.fn().mockResolvedValue("a2");

    // b and c are still cached — checked first so re-inserting the evicted
    // "a" below doesn't itself evict one of them before we assert.
    await cached("b", { tags: ["sync"] }, reloadB);
    await cached("c", { tags: ["sync"] }, reloadC);
    expect(reloadB).not.toHaveBeenCalled();
    expect(reloadC).not.toHaveBeenCalled();

    // a was evicted, so this is a genuine miss.
    await cached("a", { tags: ["sync"] }, reloadA);
    expect(reloadA).toHaveBeenCalledTimes(1);
  });
});

describe("stableKey", () => {
  it("is independent of object key order", () => {
    expect(stableKey({ a: 1, b: 2 })).toBe(stableKey({ b: 2, a: 1 }));
  });

  it("sorts keys recursively in nested objects and arrays", () => {
    const left = { outer: { z: 1, a: [{ y: 2, x: 1 }] }, top: true };
    const right = { top: true, outer: { a: [{ x: 1, y: 2 }], z: 1 } };
    expect(stableKey(left)).toBe(stableKey(right));
  });

  it("distinguishes genuinely different values", () => {
    expect(stableKey({ a: 1 })).not.toBe(stableKey({ a: 2 }));
  });
});
