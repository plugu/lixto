import { describe, expect, it } from "vitest";
import {
  buildInsertCnaes,
  buildUpdateCompany,
  validateCnaes,
  type CnaeInput,
  type CompanyInput,
} from "./company-queries";

const baseInput: CompanyInput = {
  legalName: "Acme Ltda",
  tradeName: "Acme",
  legalNature: "206-2 - Sociedade Empresária Limitada",
  size: "ME",
  simplesOptant: true,
  stateRegistration: "123456",
  municipalRegistration: "654321",
  postalCode: "01310-100",
  street: "Av. Paulista",
  streetNumber: "1000",
  addressLine2: "Sala 1",
  district: "Bela Vista",
  cityName: "São Paulo",
  state: "sp",
  phone: "(11) 99999-0000",
  email: "contato@acme.com",
};

describe("buildUpdateCompany", () => {
  it("includes WHERE id = $1 with companyId as the first value", () => {
    const { text, values } = buildUpdateCompany(42, baseInput);
    expect(text).toContain("WHERE id = $1");
    expect(values[0]).toBe(42);
  });

  it("strips non-digits from postal_code", () => {
    const { values } = buildUpdateCompany(1, baseInput);
    const idx = values.findIndex((v) => v === "01310100");
    expect(idx).toBeGreaterThan(-1);
  });

  it("uppercases state", () => {
    const { values } = buildUpdateCompany(1, baseInput);
    expect(values).toContain("SP");
  });

  it("sets size to null when the input is an empty string", () => {
    const { values } = buildUpdateCompany(1, { ...baseInput, size: "" });
    // size is the 5th SET column -> $5 -> values[4]
    expect(values[4]).toBeNull();
  });

  it("sets postal_code to null when the input is an empty string", () => {
    const { values } = buildUpdateCompany(1, { ...baseInput, postalCode: "" });
    expect(values[8]).toBeNull();
  });

  it("nulls out optional text fields left blank", () => {
    const { values } = buildUpdateCompany(1, {
      ...baseInput,
      tradeName: "   ",
      addressLine2: "",
    });
    expect(values[2]).toBeNull(); // trade_name
    expect(values[11]).toBeNull(); // address_line2
  });
});

describe("buildInsertCnaes", () => {
  const cnaes: CnaeInput[] = [
    {
      code: "6201-5/01",
      description: "Desenvolvimento de software",
      isPrimary: true,
    },
    { code: "6202-3/00", description: "Consultoria em TI", isPrimary: false },
  ];

  it("uses companyId as $1 for every row", () => {
    const { text, values } = buildInsertCnaes(7, cnaes);
    expect(values[0]).toBe(7);
    expect(text).toContain("($1,");
  });

  it("flattens each cnae into values, stripping code formatting", () => {
    const { values } = buildInsertCnaes(7, cnaes);
    expect(values).toEqual([
      7,
      "6201501",
      "Desenvolvimento de software",
      true,
      "6202300",
      "Consultoria em TI",
      false,
    ]);
  });
});

describe("validateCnaes", () => {
  it("throws when there are zero primary CNAEs", () => {
    expect(() =>
      validateCnaes([
        { code: "6201501", description: "Software", isPrimary: false },
      ]),
    ).toThrow();
  });

  it("throws when there is more than one primary CNAE", () => {
    expect(() =>
      validateCnaes([
        { code: "6201501", description: "Software", isPrimary: true },
        { code: "6202300", description: "Consultoria", isPrimary: true },
      ]),
    ).toThrow();
  });

  it("does not throw when exactly one CNAE is primary", () => {
    expect(() =>
      validateCnaes([
        { code: "6201501", description: "Software", isPrimary: true },
        { code: "6202300", description: "Consultoria", isPrimary: false },
      ]),
    ).not.toThrow();
  });
});
