import { describe, expect, it } from "vitest";
import { normalizeCnaeCode } from "./company-queries";
import {
  buildInsertCnaes,
  buildInsertCompany,
  buildInsertUser,
  type SignupCompanyInput,
  type SignupUserInput,
} from "./signup-queries";

const COMPANY_INPUT: SignupCompanyInput = {
  taxId: "00.000.000/0001-91",
  legalName: "BANCO DO BRASIL SA",
  tradeName: "BB",
  legalNature: "206-2 - Sociedade de Economia Mista",
  size: "LARGE",
  simplesOptant: false,
  stateRegistration: null,
  municipalRegistration: null,
  postalCode: "70040-912",
  street: "SAUN QUADRA 5",
  streetNumber: "S/N",
  addressLine2: null,
  district: "ASA NORTE",
  cityName: "BRASILIA",
  state: "DF",
  phone: "6134938000",
  email: "Contato@BB.com.br",
};

describe("buildInsertCompany", () => {
  it("produces a parameterized INSERT with digits-only tax_id/postal_code and lowercased email", () => {
    const query = buildInsertCompany(COMPANY_INPUT);

    expect(query.text).toContain("INSERT INTO companies");
    expect(query.text).toContain("RETURNING id");
    expect(query.values[0]).toBe("00000000000191");
    expect(query.values[8]).toBe("70040912");
    expect(query.values[query.values.length - 1]).toBe("contato@bb.com.br");
  });

  it("passes through null optional fields untouched", () => {
    const query = buildInsertCompany({
      ...COMPANY_INPUT,
      postalCode: null,
      email: null,
    });
    expect(query.values[8]).toBeNull();
    expect(query.values[query.values.length - 1]).toBeNull();
  });
});

describe("buildInsertCnaes", () => {
  it("flattens multiple cnae rows into a single multi-row INSERT", () => {
    const query = buildInsertCnaes(42, [
      { code: "6421200", description: "Bancos comerciais", isPrimary: true },
      { code: "6422100", description: "Bancos múltiplos", isPrimary: false },
    ]);

    expect(query.text).toContain("INSERT INTO company_cnaes");
    expect(query.text).toMatch(/\(\$1, \$2, \$3, \$4\), \(\$1, \$5, \$6, \$7\)/);
    expect(query.values).toEqual([
      42,
      "6421200",
      "Bancos comerciais",
      true,
      "6422100",
      "Bancos múltiplos",
      false,
    ]);
  });

  it("returns an empty VALUES row set when given no cnaes", () => {
    const query = buildInsertCnaes(42, []);
    expect(query.values).toEqual([42]);
  });

  it("pads a short code the same way company-queries.normalizeCnaeCode does", () => {
    // Reviewer finding 11: signup and the company profile page must write
    // the same CHAR(7) shape for a re-saved CNAE, or the join to
    // procurement_cnaes silently breaks.
    const query = buildInsertCnaes(1, [
      { code: "620150", description: "Software", isPrimary: true },
    ]);
    expect(query.values[1]).toBe(normalizeCnaeCode("620150"));
    expect(query.values[1]).toBe("0620150");
  });
});

describe("buildInsertUser", () => {
  const user: SignupUserInput = {
    name: "Ana Silva",
    email: "Ana@Empresa.com",
    passwordHash: "scrypt$abc$def",
    cpf: "111.444.777-35",
    phone: "11999999999",
    jobTitle: "Diretora",
  };

  it("produces a parameterized INSERT with role admin, digits-only cpf and lowercased email", () => {
    const query = buildInsertUser(42, user);

    expect(query.text).toContain("INSERT INTO users");
    expect(query.text).toContain("'admin'");
    expect(query.values).toEqual([
      42,
      "ana@empresa.com",
      "scrypt$abc$def",
      "Ana Silva",
      "11144477735",
      "11999999999",
      "Diretora",
    ]);
  });

  it("keeps cpf null when not provided", () => {
    const query = buildInsertUser(42, { ...user, cpf: null });
    expect(query.values[4]).toBeNull();
  });
});
