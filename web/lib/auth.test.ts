import { describe, expect, it, vi } from "vitest";

// vi.mock hoists above these imports — getSession touches both, and this
// file otherwise never opens a real DB connection or reads cookies.
vi.mock("./db", () => ({ pool: { query: vi.fn().mockResolvedValue({ rows: [] }) } }));
vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({
    get: () => ({ value: "raw-token" }),
  }),
}));

import {
  buildSessionByTokenQuery,
  classifyLogin,
  getSession,
  hashPassword,
  verifyPassword,
} from "./auth";
import { pool } from "./db";

describe("hashPassword / verifyPassword", () => {
  it("produces a scrypt$salt$hash string", async () => {
    const stored = await hashPassword("senha-super-secreta");
    const parts = stored.split("$");
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe("scrypt");
    expect(parts[1]).toMatch(/^[0-9a-f]{32}$/); // 16-byte salt
    expect(parts[2]).toMatch(/^[0-9a-f]{128}$/); // 64-byte derived key
  });

  it("round-trips the correct password", async () => {
    const stored = await hashPassword("senha-super-secreta");
    await expect(verifyPassword("senha-super-secreta", stored)).resolves.toBe(
      true,
    );
  });

  it("rejects a wrong password", async () => {
    const stored = await hashPassword("senha-super-secreta");
    await expect(verifyPassword("senha-errada", stored)).resolves.toBe(false);
  });

  it("rejects an empty password against a real hash", async () => {
    const stored = await hashPassword("senha-super-secreta");
    await expect(verifyPassword("", stored)).resolves.toBe(false);
  });

  it("rejects a tampered hash", async () => {
    const stored = await hashPassword("senha-super-secreta");
    const [, salt, hash] = stored.split("$");
    const flipped = (hash[0] === "a" ? "b" : "a") + hash.slice(1);
    await expect(
      verifyPassword("senha-super-secreta", `scrypt$${salt}$${flipped}`),
    ).resolves.toBe(false);
  });

  it("rejects a tampered salt", async () => {
    const stored = await hashPassword("senha-super-secreta");
    const [, salt, hash] = stored.split("$");
    const flipped = (salt[0] === "a" ? "b" : "a") + salt.slice(1);
    await expect(
      verifyPassword("senha-super-secreta", `scrypt$${flipped}$${hash}`),
    ).resolves.toBe(false);
  });

  it("rejects malformed stored values", async () => {
    for (const bad of [
      "",
      "senha-super-secreta",
      "scrypt$abc",
      "bcrypt$aa$bb",
      "scrypt$zz$zz",
      "scrypt$00112233445566778899aabbccddeeff$00",
    ]) {
      await expect(verifyPassword("senha-super-secreta", bad)).resolves.toBe(
        false,
      );
    }
  });

  it("uses a random salt, so two hashes of the same password differ", async () => {
    const a = await hashPassword("senha-super-secreta");
    const b = await hashPassword("senha-super-secreta");
    expect(a).not.toBe(b);
    await expect(verifyPassword("senha-super-secreta", a)).resolves.toBe(true);
    await expect(verifyPassword("senha-super-secreta", b)).resolves.toBe(true);
  });
});

// The DB path of login() is not exercised here (vitest runs node-only, with
// no pool); classifyLogin is the whole decision it makes.
describe("classifyLogin", () => {
  it("accepts the right password on an approved company", () => {
    expect(classifyLogin(true, "approved")).toBe("ok");
  });

  it("reports a pending company", () => {
    expect(classifyLogin(true, "pending")).toBe("pending");
  });

  it("reports a rejected company", () => {
    expect(classifyLogin(true, "rejected")).toBe("rejected");
  });

  it("says invalid for a wrong password on an approved company", () => {
    expect(classifyLogin(false, "approved")).toBe("invalid");
  });

  it("says invalid — not pending — for a wrong password on a pending company", () => {
    expect(classifyLogin(false, "pending")).toBe("invalid");
  });

  it("says invalid — not rejected — for a wrong password on a rejected company", () => {
    expect(classifyLogin(false, "rejected")).toBe("invalid");
  });
});

// F3: getSession's live re-check (ADR 003 §D3) has to filter on both the
// token/expiry and the company's approval status — assert the query text
// carries both predicates rather than trusting a live DB round trip.
describe("buildSessionByTokenQuery", () => {
  it("binds the token hash and requires an approved, unexpired session", () => {
    const query = buildSessionByTokenQuery("deadbeef");
    expect(query.values).toEqual(["deadbeef"]);
    expect(query.text).toMatch(/s\.token_hash\s*=\s*\$1/);
    expect(query.text).toContain("approval_status = 'approved'");
    expect(query.text).toContain("expires_at > now()");
  });
});

// getSession is exported as `cache(getSessionUncached)` (ticket 174): the
// same module-level function reference every import, memoised per request.
describe("getSession (React cache wrapper)", () => {
  it("is the same function reference on repeated imports", async () => {
    const a = await import("./auth");
    const b = await import("./auth");
    expect(a.getSession).toBe(getSession);
    expect(b.getSession).toBe(getSession);
  });

  it("hits pool.query on every call outside a React render", async () => {
    // React's cache() only dedupes within one server render's async-storage
    // scope; a plain Vitest call has no such scope, so cache() falls back to
    // invoking the wrapped function directly each time. This asserts (and
    // documents) that fallback rather than asserting single-flight
    // behaviour we can't reproduce without a real render — the request-scope
    // guarantee itself is React's, not ours to re-test.
    const queryMock = pool.query as unknown as ReturnType<typeof vi.fn>;
    queryMock.mockClear();

    await getSession();
    await getSession();

    expect(queryMock).toHaveBeenCalledTimes(2);
  });
});
