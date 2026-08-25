import { describe, expect, it } from "vitest";
import {
  buildAcceptInvite,
  buildListUsers,
  buildRemoveUser,
  buildUpdateRole,
  hashToken,
} from "./user-queries";

describe("hashToken", () => {
  it("returns a 64-char hex string", () => {
    expect(hashToken("some-token")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic", () => {
    expect(hashToken("abc")).toBe(hashToken("abc"));
  });

  it("differs for different inputs", () => {
    expect(hashToken("abc")).not.toBe(hashToken("abd"));
  });
});

describe("buildListUsers", () => {
  it("binds company_id and orders by name", () => {
    const query = buildListUsers(42);
    expect(query.text).toMatch(/company_id\s*=\s*\$1/);
    expect(query.text).toMatch(/ORDER BY name/);
    expect(query.values).toEqual([42]);
  });
});

describe("buildUpdateRole", () => {
  it("binds company_id, id and role", () => {
    const query = buildUpdateRole(42, 7, "admin");
    expect(query.text).toMatch(/company_id\s*=\s*\$3/);
    expect(query.text).toMatch(/id\s*=\s*\$2/);
    expect(query.values).toEqual(["admin", 7, 42]);
  });
});

describe("buildRemoveUser", () => {
  it("binds company_id and id", () => {
    const query = buildRemoveUser(42, 7);
    expect(query.text).toMatch(/company_id\s*=\s*\$2/);
    expect(query.text).toMatch(/id\s*=\s*\$1/);
    expect(query.values).toEqual([7, 42]);
  });
});

describe("buildAcceptInvite", () => {
  it("does not bind company_id, binds the token hash instead", () => {
    const query = buildAcceptInvite("deadbeef", {
      name: "Fulano",
      passwordHash: "scrypt$a$b",
    });
    expect(query.text).not.toMatch(/company_id/);
    expect(query.values).toContain("deadbeef");
  });

  it("guards on password_hash IS NULL and invite_expires_at > now()", () => {
    const query = buildAcceptInvite("deadbeef", {
      name: "Fulano",
      passwordHash: "scrypt$a$b",
    });
    expect(query.text).toMatch(/password_hash IS NULL/);
    expect(query.text).toMatch(/invite_expires_at > now\(\)/);
  });

  it("defaults optional fields to null", () => {
    const query = buildAcceptInvite("deadbeef", {
      name: "Fulano",
      passwordHash: "scrypt$a$b",
    });
    // values order: passwordHash, name, cpf, phone, jobTitle, tokenHash
    expect(query.values).toEqual([
      "scrypt$a$b",
      "Fulano",
      null,
      null,
      null,
      "deadbeef",
    ]);
  });

  it("passes through provided optional fields", () => {
    const query = buildAcceptInvite("deadbeef", {
      name: "Fulano",
      passwordHash: "scrypt$a$b",
      cpf: "12345678901",
      phone: "11999999999",
      jobTitle: "Diretor",
    });
    expect(query.values).toEqual([
      "scrypt$a$b",
      "Fulano",
      "12345678901",
      "11999999999",
      "Diretor",
      "deadbeef",
    ]);
  });
});
