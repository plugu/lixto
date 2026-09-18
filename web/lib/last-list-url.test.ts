import { describe, expect, it } from "vitest";
import {
  lastListUrlKey,
  readLastListUrl,
  writeLastListUrl,
} from "./last-list-url";

function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

const throwing = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
  removeItem: () => {
    throw new Error("blocked");
  },
};

describe("lastListUrlKey", () => {
  it("namespaces the key by list path", () => {
    expect(lastListUrlKey("/procurements")).toBe(
      "lixto.lastListUrl:/procurements",
    );
  });
});

describe("readLastListUrl", () => {
  it("returns the bare path when nothing is remembered", () => {
    expect(readLastListUrl(fakeStorage(), "/procurements")).toBe(
      "/procurements",
    );
  });

  it("appends the remembered query string", () => {
    const storage = fakeStorage({
      [lastListUrlKey("/procurements")]: "?state=SP&sort=value_desc&page=2",
    });
    expect(readLastListUrl(storage, "/procurements")).toBe(
      "/procurements?state=SP&sort=value_desc&page=2",
    );
  });

  it("ignores a remembered value that is not a query string", () => {
    const storage = fakeStorage({
      [lastListUrlKey("/procurements")]: "https://evil.example/x",
    });
    expect(readLastListUrl(storage, "/procurements")).toBe("/procurements");
  });

  it("falls back to the bare path when storage throws", () => {
    expect(readLastListUrl(throwing, "/procurements")).toBe("/procurements");
  });

  it("falls back to the bare path when storage is unavailable", () => {
    expect(readLastListUrl(null, "/procurements")).toBe("/procurements");
  });
});

describe("writeLastListUrl", () => {
  it("stores a non-empty query string with its leading ?", () => {
    const storage = fakeStorage();
    writeLastListUrl(storage, "/procurements", "state=SP");
    expect(storage.getItem(lastListUrlKey("/procurements"))).toBe("?state=SP");
  });

  it("accepts a query string that already has the leading ?", () => {
    const storage = fakeStorage();
    writeLastListUrl(storage, "/procurements", "?state=SP");
    expect(storage.getItem(lastListUrlKey("/procurements"))).toBe("?state=SP");
  });

  it("clears the entry for an empty query string so the bare list is remembered", () => {
    const storage = fakeStorage({
      [lastListUrlKey("/procurements")]: "?state=SP",
    });
    writeLastListUrl(storage, "/procurements", "");
    expect(storage.getItem(lastListUrlKey("/procurements"))).toBeNull();
  });

  it("swallows storage errors", () => {
    expect(() =>
      writeLastListUrl(throwing, "/procurements", "state=SP"),
    ).not.toThrow();
  });
});
