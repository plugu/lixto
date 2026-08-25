import { describe, expect, it } from "vitest";
import { normalizeTerm, normalizeTerms } from "./normalize";

describe("normalizeTerm", () => {
  it("strips accents, lowercases and collapses whitespace", () => {
    expect(normalizeTerm("Lápis Preto  nº 2 ")).toBe("lapis preto no 2");
  });

  it("normalizes ç", () => {
    expect(normalizeTerm("Ção")).toBe("cao");
  });

  it("trims leading/trailing whitespace", () => {
    expect(normalizeTerm("  papel  ")).toBe("papel");
  });

  it("caps at 40 characters", () => {
    const long = "a".repeat(60);
    expect(normalizeTerm(long)).toHaveLength(40);
  });

  it("returns empty string for empty/whitespace input", () => {
    expect(normalizeTerm("")).toBe("");
    expect(normalizeTerm("   ")).toBe("");
  });
});

describe("normalizeTerms", () => {
  it("normalizes every term", () => {
    expect(normalizeTerms(["Lápis", "Papel"])).toEqual(["lapis", "papel"]);
  });

  it("drops empties", () => {
    expect(normalizeTerms(["lapis", "  ", ""])).toEqual(["lapis"]);
  });

  it("dedupes preserving first-seen order", () => {
    expect(normalizeTerms(["Lápis", "lapis", "LAPIS", "papel"])).toEqual([
      "lapis",
      "papel",
    ]);
  });

  it("caps at 50 terms", () => {
    const xs = Array.from({ length: 60 }, (_, i) => `termo${i}`);
    expect(normalizeTerms(xs)).toHaveLength(50);
  });
});
