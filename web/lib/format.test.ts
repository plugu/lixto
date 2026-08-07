import { describe, expect, it } from "vitest";
import { formatCurrencyBRL, formatDateBR } from "./format";
import { computeStatus } from "./status";

describe("formatCurrencyBRL", () => {
  it("formats a number as R$ with pt-BR separators", () => {
    expect(formatCurrencyBRL(1234.56)).toBe("R$ 1.234,56");
  });

  it("formats a numeric string (as returned by pg for NUMERIC columns)", () => {
    expect(formatCurrencyBRL("1234.56")).toBe("R$ 1.234,56");
  });

  it("formats zero", () => {
    expect(formatCurrencyBRL(0)).toBe("R$ 0,00");
  });

  it("returns a dash for null/undefined/invalid values", () => {
    expect(formatCurrencyBRL(null)).toBe("—");
    expect(formatCurrencyBRL(undefined)).toBe("—");
    expect(formatCurrencyBRL("not-a-number")).toBe("—");
  });
});

describe("formatDateBR", () => {
  it("formats a date as dd/mm/aaaa", () => {
    expect(formatDateBR(new Date("2026-03-05T12:00:00Z"))).toBe("05/03/2026");
  });

  it("formats a date with time when withTime is true", () => {
    expect(formatDateBR(new Date("2026-03-05T12:30:00Z"), true)).toBe(
      "05/03/2026 09:30",
    );
  });

  it("accepts ISO strings", () => {
    expect(formatDateBR("2026-01-01T00:00:00Z")).toBe("31/12/2025");
  });

  it("returns a dash for null/undefined/invalid values", () => {
    expect(formatDateBR(null)).toBe("—");
    expect(formatDateBR(undefined)).toBe("—");
    expect(formatDateBR("not-a-date")).toBe("—");
  });
});

describe("computeStatus", () => {
  const now = new Date("2026-06-15T12:00:00Z");

  it("is aberta when now is within [abertura, encerramento)", () => {
    const abertura = new Date("2026-06-01T00:00:00Z");
    const encerramento = new Date("2026-07-01T00:00:00Z");
    expect(computeStatus(abertura, encerramento, now)).toBe("aberta");
  });

  it("is aberta exactly at the abertura boundary (inclusive)", () => {
    const encerramento = new Date("2026-07-01T00:00:00Z");
    expect(computeStatus(now, encerramento, now)).toBe("aberta");
  });

  it("is fechada exactly at the encerramento boundary (exclusive)", () => {
    const abertura = new Date("2026-06-01T00:00:00Z");
    expect(computeStatus(abertura, now, now)).toBe("fechada");
  });

  it("is vai_abrir when abertura is in the future", () => {
    const abertura = new Date("2026-07-01T00:00:00Z");
    const encerramento = new Date("2026-08-01T00:00:00Z");
    expect(computeStatus(abertura, encerramento, now)).toBe("vai_abrir");
  });

  it("is fechada when encerramento is in the past", () => {
    const abertura = new Date("2026-01-01T00:00:00Z");
    const encerramento = new Date("2026-02-01T00:00:00Z");
    expect(computeStatus(abertura, encerramento, now)).toBe("fechada");
  });

  it("is fechada when encerramento is null", () => {
    const abertura = new Date("2026-01-01T00:00:00Z");
    expect(computeStatus(abertura, null, now)).toBe("fechada");
  });

  it("is fechada when abertura is null", () => {
    const encerramento = new Date("2026-07-01T00:00:00Z");
    expect(computeStatus(null, encerramento, now)).toBe("fechada");
  });
});
