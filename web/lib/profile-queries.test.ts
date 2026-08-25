import { beforeEach, describe, expect, it, vi } from "vitest";

// Relative imports (not "@/lib/...") on purpose: vitest runs without a config
// file. The pool is mocked — these tests never touch a live database.
vi.mock("./db", () => ({ pool: { query: vi.fn() } }));

import { pool } from "./db";
import {
  buildUpsertProfile,
  getProfile,
  getProfileEmbeddingText,
  parseMoney,
  parseTermList,
  type ProfileInput,
} from "./profile-queries";

const query = pool.query as unknown as ReturnType<typeof vi.fn>;

const baseInput: ProfileInput = {
  products: ["Papel A4", "Caneta esferográfica"],
  keywords: ["material de escritório"],
  exclusions: ["Combustível"],
  states: ["rj", "sp"],
  minValue: "",
  maxValue: "",
  notes: "",
};

beforeEach(() => {
  query.mockReset();
});

describe("parseTermList", () => {
  it("splits on newline, comma and semicolon", () => {
    expect(parseTermList("papel\ncaneta,lápis;borracha")).toEqual([
      "papel",
      "caneta",
      "lápis",
      "borracha",
    ]);
  });

  it("trims and drops empty entries", () => {
    expect(parseTermList("  papel  \n\n, ,caneta")).toEqual(["papel", "caneta"]);
  });

  it("dedupes preserving first-seen order", () => {
    expect(parseTermList("papel,caneta,papel")).toEqual(["papel", "caneta"]);
  });

  it("caps at 50 entries", () => {
    const raw = Array.from({ length: 60 }, (_, i) => `term${i}`).join(",");
    expect(parseTermList(raw)).toHaveLength(50);
  });

  it("returns an empty array for an empty string", () => {
    expect(parseTermList("")).toEqual([]);
  });
});

describe("parseMoney", () => {
  it("returns null for an empty string", () => {
    expect(parseMoney("")).toBeNull();
    expect(parseMoney("   ")).toBeNull();
  });

  it("parses a plain digit string", () => {
    expect(parseMoney("50000")).toBe("50000");
  });

  it("parses pt-BR thousand/decimal separators", () => {
    expect(parseMoney("50.000,00")).toBe("50000.00");
  });

  it("strips currency symbols and spaces", () => {
    expect(parseMoney("R$ 50.000,00")).toBe("50000.00");
  });
});

describe("buildUpsertProfile", () => {
  it("binds companyId as $1", () => {
    const { text, values } = buildUpsertProfile(42, baseInput);
    expect(text).toContain("INSERT INTO company_profiles");
    expect(values[0]).toBe(42);
  });

  it("computes terms from products ∪ keywords, normalized", () => {
    const { values } = buildUpsertProfile(1, baseInput);
    // terms is the 5th column -> $5 -> values[4]
    expect(values[4]).toEqual([
      "papel a4",
      "caneta esferografica",
      "material de escritorio",
    ]);
  });

  it("computes exclusion_terms from exclusions, normalized", () => {
    const { values } = buildUpsertProfile(1, baseInput);
    expect(values[5]).toEqual(["combustivel"]);
  });

  it("uppercases states", () => {
    const { values } = buildUpsertProfile(1, baseInput);
    expect(values[6]).toEqual(["RJ", "SP"]);
  });

  it("defaults to an empty states array", () => {
    const { values } = buildUpsertProfile(1, { ...baseInput, states: [] });
    expect(values[6]).toEqual([]);
  });

  it("parses 'R$ 50.000,00' into a decimal string", () => {
    const { values } = buildUpsertProfile(1, {
      ...baseInput,
      minValue: "R$ 50.000,00",
    });
    expect(values[7]).toBe("50000.00");
  });

  it("nulls out empty minValue/maxValue", () => {
    const { values } = buildUpsertProfile(1, baseInput);
    expect(values[7]).toBeNull();
    expect(values[8]).toBeNull();
  });

  it("nulls out empty notes", () => {
    const { values } = buildUpsertProfile(1, { ...baseInput, notes: "   " });
    expect(values[9]).toBeNull();
  });

  it("leaves the embedding columns out when none is given", () => {
    const { text, values } = buildUpsertProfile(1, baseInput);
    expect(text).not.toContain("embedding");
    expect(text).not.toContain("::vector");
    expect(values).toHaveLength(10);
  });

  it("binds the vector as text and casts it when an embedding is given", () => {
    const { text, values } = buildUpsertProfile(42, baseInput, {
      vector: [0.1, 0.2, 0.3],
      model: "text-embedding-3-small",
      text: "produtos: papel",
    });

    expect(values[0]).toBe(42);
    expect(text).toContain("$11::vector");
    expect(text).toContain("embedding_text = $12");
    expect(text).toContain("embedding_model = $13");
    expect(values[10]).toBe("[0.1,0.2,0.3]");
    expect(values[11]).toBe("produtos: papel");
    expect(values[12]).toBe("text-embedding-3-small");
    expect(text).not.toContain("0.1,0.2,0.3");
  });

  it("keeps every placeholder numbered with no gaps", () => {
    const { text, values } = buildUpsertProfile(1, baseInput, {
      vector: [0.5],
      model: "m",
      text: "t",
    });
    const used = new Set([...text.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])));
    for (let i = 1; i <= values.length; i++) {
      expect(used.has(i)).toBe(true);
    }
    expect(Math.max(...used)).toBe(values.length);
  });
});

describe("getProfileEmbeddingText", () => {
  it("selects the vector cast to text and returns null when absent", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    expect(await getProfileEmbeddingText(1)).toBeNull();

    const [text, values] = query.mock.calls[0];
    expect(text).toContain("embedding::text AS embedding");
    expect(text).toContain("WHERE company_id = $1");
    expect(values).toEqual([1]);
  });

  it("returns the literal when present", async () => {
    query.mockResolvedValueOnce({ rows: [{ embedding: "[0.1,0.2]" }] });
    expect(await getProfileEmbeddingText(1)).toBe("[0.1,0.2]");
  });

  it("returns null when the row exists but has no vector", async () => {
    query.mockResolvedValueOnce({ rows: [{ embedding: null }] });
    expect(await getProfileEmbeddingText(1)).toBeNull();
  });
});

describe("getProfile", () => {
  it("returns null when there is no row", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    expect(await getProfile(1)).toBeNull();
  });

  it("returns the row when present", async () => {
    const row = {
      company_id: 1,
      products: ["papel"],
      keywords: [],
      exclusions: [],
      terms: ["papel"],
      exclusion_terms: [],
      states: ["RJ"],
      min_value: null,
      max_value: null,
      notes: null,
      embedding_text: "produtos: papel",
    };
    query.mockResolvedValueOnce({ rows: [row] });
    expect(await getProfile(1)).toEqual(row);
  });
});
