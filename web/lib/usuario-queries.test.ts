import { describe, expect, it } from "vitest";
import {
  buildAcceptConvite,
  buildListUsuarios,
  buildRemoveUsuario,
  buildUpdateRole,
  hashToken,
} from "./usuario-queries";

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

describe("buildListUsuarios", () => {
  it("binds empresa_id and orders by nome", () => {
    const query = buildListUsuarios(42);
    expect(query.text).toMatch(/empresa_id\s*=\s*\$1/);
    expect(query.text).toMatch(/ORDER BY nome/);
    expect(query.values).toEqual([42]);
  });
});

describe("buildUpdateRole", () => {
  it("binds empresa_id, id and role", () => {
    const query = buildUpdateRole(42, 7, "admin");
    expect(query.text).toMatch(/empresa_id\s*=\s*\$3/);
    expect(query.text).toMatch(/id\s*=\s*\$2/);
    expect(query.values).toEqual(["admin", 7, 42]);
  });
});

describe("buildRemoveUsuario", () => {
  it("binds empresa_id and id", () => {
    const query = buildRemoveUsuario(42, 7);
    expect(query.text).toMatch(/empresa_id\s*=\s*\$2/);
    expect(query.text).toMatch(/id\s*=\s*\$1/);
    expect(query.values).toEqual([7, 42]);
  });
});

describe("buildAcceptConvite", () => {
  it("does not bind empresa_id, binds the token hash instead", () => {
    const query = buildAcceptConvite("deadbeef", {
      nome: "Fulano",
      senhaHash: "scrypt$a$b",
    });
    expect(query.text).not.toMatch(/empresa_id/);
    expect(query.values).toContain("deadbeef");
  });

  it("guards on senha_hash IS NULL and convite_expira_em > now()", () => {
    const query = buildAcceptConvite("deadbeef", {
      nome: "Fulano",
      senhaHash: "scrypt$a$b",
    });
    expect(query.text).toMatch(/senha_hash IS NULL/);
    expect(query.text).toMatch(/convite_expira_em > now\(\)/);
  });

  it("defaults optional fields to null", () => {
    const query = buildAcceptConvite("deadbeef", {
      nome: "Fulano",
      senhaHash: "scrypt$a$b",
    });
    // values order: senhaHash, nome, cpf, telefone, cargo, tokenHash
    expect(query.values).toEqual(["scrypt$a$b", "Fulano", null, null, null, "deadbeef"]);
  });

  it("passes through provided optional fields", () => {
    const query = buildAcceptConvite("deadbeef", {
      nome: "Fulano",
      senhaHash: "scrypt$a$b",
      cpf: "12345678901",
      telefone: "11999999999",
      cargo: "Diretor",
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
