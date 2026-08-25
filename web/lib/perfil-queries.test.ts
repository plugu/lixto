import { beforeEach, describe, expect, it, vi } from "vitest";

// Relative imports (not "@/lib/...") on purpose: vitest runs without a config
// file. The pool is mocked — these tests never touch a live database.
vi.mock("./db", () => ({ pool: { query: vi.fn() } }));

import { pool } from "./db";
import {
  buildUpsertPerfil,
  getPerfil,
  getPerfilEmbeddingText,
  parseTermList,
  parseValor,
  type PerfilInput,
} from "./perfil-queries";

const query = pool.query as unknown as ReturnType<typeof vi.fn>;

const baseInput: PerfilInput = {
  produtos: ["Papel A4", "Caneta esferográfica"],
  palavrasChave: ["material de escritório"],
  exclusoes: ["Combustível"],
  ufs: ["rj", "sp"],
  valorMin: "",
  valorMax: "",
  observacoes: "",
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
    const raw = Array.from({ length: 60 }, (_, i) => `termo${i}`).join(",");
    expect(parseTermList(raw)).toHaveLength(50);
  });

  it("returns an empty array for an empty string", () => {
    expect(parseTermList("")).toEqual([]);
  });
});

describe("parseValor", () => {
  it("returns null for an empty string", () => {
    expect(parseValor("")).toBeNull();
    expect(parseValor("   ")).toBeNull();
  });

  it("parses a plain digit string", () => {
    expect(parseValor("50000")).toBe("50000");
  });

  it("parses pt-BR thousand/decimal separators", () => {
    expect(parseValor("50.000,00")).toBe("50000.00");
  });

  it("strips currency symbols and spaces", () => {
    expect(parseValor("R$ 50.000,00")).toBe("50000.00");
  });
});

describe("buildUpsertPerfil", () => {
  it("binds empresaId as $1", () => {
    const { text, values } = buildUpsertPerfil(42, baseInput);
    expect(text).toContain("INSERT INTO empresa_perfil");
    expect(values[0]).toBe(42);
  });

  it("computes termos from produtos ∪ palavras_chave, normalized", () => {
    const { values } = buildUpsertPerfil(1, baseInput);
    // termos is the 5th column -> $5 -> values[4]
    expect(values[4]).toEqual(["papel a4", "caneta esferografica", "material de escritorio"]);
  });

  it("computes exclusoes_termos from exclusoes, normalized", () => {
    const { values } = buildUpsertPerfil(1, baseInput);
    expect(values[5]).toEqual(["combustivel"]);
  });

  it("uppercases ufs", () => {
    const { values } = buildUpsertPerfil(1, baseInput);
    expect(values[6]).toEqual(["RJ", "SP"]);
  });

  it("defaults to an empty ufs array", () => {
    const { values } = buildUpsertPerfil(1, { ...baseInput, ufs: [] });
    expect(values[6]).toEqual([]);
  });

  it("parses 'R$ 50.000,00' into a decimal string", () => {
    const { values } = buildUpsertPerfil(1, { ...baseInput, valorMin: "R$ 50.000,00" });
    expect(values[7]).toBe("50000.00");
  });

  it("nulls out empty valorMin/valorMax", () => {
    const { values } = buildUpsertPerfil(1, baseInput);
    expect(values[7]).toBeNull();
    expect(values[8]).toBeNull();
  });

  it("nulls out empty observacoes", () => {
    const { values } = buildUpsertPerfil(1, { ...baseInput, observacoes: "   " });
    expect(values[9]).toBeNull();
  });

  it("leaves the embedding columns out when none is given", () => {
    const { text, values } = buildUpsertPerfil(1, baseInput);
    expect(text).not.toContain("embedding");
    expect(text).not.toContain("::vector");
    expect(values).toHaveLength(10);
  });

  it("binds the vector as text and casts it when an embedding is given", () => {
    const { text, values } = buildUpsertPerfil(42, baseInput, {
      vector: [0.1, 0.2, 0.3],
      model: "text-embedding-3-small",
      texto: "produtos: papel",
    });

    expect(values[0]).toBe(42);
    expect(text).toContain("$11::vector");
    expect(text).toContain("embedding_texto = $12");
    expect(text).toContain("embedding_modelo = $13");
    expect(values[10]).toBe("[0.1,0.2,0.3]");
    expect(values[11]).toBe("produtos: papel");
    expect(values[12]).toBe("text-embedding-3-small");
    expect(text).not.toContain("0.1,0.2,0.3");
  });

  it("keeps every placeholder numbered with no gaps", () => {
    const { text, values } = buildUpsertPerfil(1, baseInput, {
      vector: [0.5],
      model: "m",
      texto: "t",
    });
    const usados = new Set(
      [...text.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])),
    );
    for (let i = 1; i <= values.length; i++) {
      expect(usados.has(i)).toBe(true);
    }
    expect(Math.max(...usados)).toBe(values.length);
  });
});

describe("getPerfilEmbeddingText", () => {
  it("selects the vector cast to text and returns null when absent", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    expect(await getPerfilEmbeddingText(1)).toBeNull();

    const [text, values] = query.mock.calls[0];
    expect(text).toContain("embedding::text AS embedding");
    expect(text).toContain("WHERE empresa_id = $1");
    expect(values).toEqual([1]);
  });

  it("returns the literal when present", async () => {
    query.mockResolvedValueOnce({ rows: [{ embedding: "[0.1,0.2]" }] });
    expect(await getPerfilEmbeddingText(1)).toBe("[0.1,0.2]");
  });

  it("returns null when the row exists but has no vector", async () => {
    query.mockResolvedValueOnce({ rows: [{ embedding: null }] });
    expect(await getPerfilEmbeddingText(1)).toBeNull();
  });
});

describe("getPerfil", () => {
  it("returns null when there is no row", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    expect(await getPerfil(1)).toBeNull();
  });

  it("returns the row when present", async () => {
    const row = {
      empresa_id: 1,
      produtos: ["papel"],
      palavras_chave: [],
      exclusoes: [],
      termos: ["papel"],
      exclusoes_termos: [],
      ufs: ["RJ"],
      valor_min: null,
      valor_max: null,
      observacoes: null,
      embedding_texto: "produtos: papel",
    };
    query.mockResolvedValueOnce({ rows: [row] });
    expect(await getPerfil(1)).toEqual(row);
  });
});
