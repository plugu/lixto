import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./auth";

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
