import { describe, expect, it } from "vitest";
import {
  formatCEP,
  formatCNPJ,
  formatCPF,
  isValidCEP,
  isValidCNPJ,
  isValidCPF,
  isValidEmail,
  onlyDigits,
} from "./br-validators";

describe("onlyDigits", () => {
  it("strips non-digit characters", () => {
    expect(onlyDigits("11.222.333/0001-81")).toBe("11222333000181");
  });
});

describe("isValidCNPJ", () => {
  it("accepts a valid formatted CNPJ", () => {
    expect(isValidCNPJ("11.222.333/0001-81")).toBe(true);
  });

  it("accepts a valid raw CNPJ", () => {
    expect(isValidCNPJ("11222333000181")).toBe(true);
  });

  it("rejects a CNPJ with a wrong check digit", () => {
    expect(isValidCNPJ("11.222.333/0001-80")).toBe(false);
  });

  it("rejects an all-same-digit CNPJ", () => {
    expect(isValidCNPJ("11111111111111")).toBe(false);
  });

  it("rejects the wrong number of digits", () => {
    expect(isValidCNPJ("1234")).toBe(false);
  });
});

describe("isValidCPF", () => {
  it("accepts a valid formatted CPF", () => {
    expect(isValidCPF("529.982.247-25")).toBe(true);
  });

  it("accepts a valid raw CPF", () => {
    expect(isValidCPF("52998224725")).toBe(true);
  });

  it("rejects a CPF with a wrong check digit", () => {
    expect(isValidCPF("529.982.247-24")).toBe(false);
  });

  it("rejects an all-same-digit CPF", () => {
    expect(isValidCPF("11111111111")).toBe(false);
  });

  it("rejects the wrong number of digits", () => {
    expect(isValidCPF("1234")).toBe(false);
  });
});

describe("isValidCEP", () => {
  it("accepts a valid formatted CEP", () => {
    expect(isValidCEP("01310-100")).toBe(true);
  });

  it("accepts a valid raw CEP", () => {
    expect(isValidCEP("01310100")).toBe(true);
  });

  it("rejects the wrong number of digits", () => {
    expect(isValidCEP("1234")).toBe(false);
  });
});

describe("formatters round-trip", () => {
  it("formatCNPJ produces the canonical mask", () => {
    expect(formatCNPJ("11222333000181")).toBe("11.222.333/0001-81");
  });

  it("formatCPF produces the canonical mask", () => {
    expect(formatCPF("52998224725")).toBe("529.982.247-25");
  });

  it("formatCEP produces the canonical mask", () => {
    expect(formatCEP("01310100")).toBe("01310-100");
  });

  it("formatCNPJ is idempotent on already-formatted input", () => {
    expect(formatCNPJ("11.222.333/0001-81")).toBe("11.222.333/0001-81");
  });
});

describe("isValidEmail", () => {
  it("accepts a simple valid email", () => {
    expect(isValidEmail("user@example.com")).toBe(true);
  });

  it("rejects an email without @", () => {
    expect(isValidEmail("user.example.com")).toBe(false);
  });

  it("rejects an email without a domain dot", () => {
    expect(isValidEmail("user@example")).toBe(false);
  });

  it("rejects an email with whitespace", () => {
    expect(isValidEmail("user @example.com")).toBe(false);
  });
});
