import { describe, expect, it } from "vitest";
import {
  buildInsertCnaes,
  buildUpdateCompany,
  normalizeCnaeCode,
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

describe("normalizeCnaeCode", () => {
  it("strips formatting and left-pads to 7 digits", () => {
    expect(normalizeCnaeCode("620-1/5")) // 5 digits after stripping
      .toBe("0062015");
  });

  it("leaves an already 7-digit code untouched", () => {
    expect(normalizeCnaeCode("6201501")).toBe("6201501");
  });

  it("matches the padding signup-queries.ts writes for the same code", () => {
    // Reviewer finding 11: a code re-saved via company-queries must land in
    // the DB identically to the one written at signup, or it never joins
    // procurement_cnaes again.
    expect(normalizeCnaeCode("62015/01")).toBe("6201501");
  });
});

describe("buildInsertCnaes pads short codes", () => {
  it("left-pads a code shorter than 7 digits", () => {
    const { values } = buildInsertCnaes(1, [
      { code: "620150", description: "Software", isPrimary: true },
    ]);
    expect(values[1]).toBe("0620150");
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
