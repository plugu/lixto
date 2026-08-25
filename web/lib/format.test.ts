import { describe, expect, it } from "vitest";
import { formatCurrencyBRL, formatDateBR } from "./format";
import { computeProcurementStatus } from "./status";

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

describe("computeProcurementStatus", () => {
  const now = new Date("2026-06-15T12:00:00Z");

  it("is open when now is within [opensAt, closesAt)", () => {
    const opensAt = new Date("2026-06-01T00:00:00Z");
    const closesAt = new Date("2026-07-01T00:00:00Z");
    expect(computeProcurementStatus(opensAt, closesAt, now)).toBe("open");
  });

  it("is open exactly at the opensAt boundary (inclusive)", () => {
    const closesAt = new Date("2026-07-01T00:00:00Z");
    expect(computeProcurementStatus(now, closesAt, now)).toBe("open");
  });

  it("is closed exactly at the closesAt boundary (exclusive)", () => {
    const opensAt = new Date("2026-06-01T00:00:00Z");
    expect(computeProcurementStatus(opensAt, now, now)).toBe("closed");
  });

  it("is upcoming when opensAt is in the future", () => {
    const opensAt = new Date("2026-07-01T00:00:00Z");
    const closesAt = new Date("2026-08-01T00:00:00Z");
    expect(computeProcurementStatus(opensAt, closesAt, now)).toBe("upcoming");
  });

  it("is closed when closesAt is in the past", () => {
    const opensAt = new Date("2026-01-01T00:00:00Z");
    const closesAt = new Date("2026-02-01T00:00:00Z");
    expect(computeProcurementStatus(opensAt, closesAt, now)).toBe("closed");
  });

  it("is closed when closesAt is null", () => {
    const opensAt = new Date("2026-01-01T00:00:00Z");
    expect(computeProcurementStatus(opensAt, null, now)).toBe("closed");
  });

  it("is closed when opensAt is null", () => {
    const closesAt = new Date("2026-07-01T00:00:00Z");
    expect(computeProcurementStatus(null, closesAt, now)).toBe("closed");
  });
});
