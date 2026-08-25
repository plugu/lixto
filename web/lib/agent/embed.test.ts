import { afterEach, describe, expect, it, vi } from "vitest";

import type OpenAI from "openai";

import {
  EMBED_DIMS,
  buildProfileEmbeddingText,
  embedText,
  toPgVector,
} from "./embed";

function fakeClient(create: ReturnType<typeof vi.fn>): OpenAI {
  return { embeddings: { create } } as unknown as OpenAI;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("toPgVector", () => {
  it("formats a vector as a pgvector literal", () => {
    expect(toPgVector([0.1, 0.2, -0.3])).toBe("[0.1,0.2,-0.3]");
  });

  it("keeps EMBED_DIMS at 1536", () => {
    expect(EMBED_DIMS).toBe(1536);
  });
});

describe("buildProfileEmbeddingText", () => {
  it("joins the three labelled parts with newlines", () => {
    expect(
      buildProfileEmbeddingText({
        products: ["papel A4", "caneta"],
        keywords: ["material escolar"],
        notes: "atendemos o RJ",
      }),
    ).toBe(
      "produtos: papel A4, caneta\npalavras-chave: material escolar\nobservações: atendemos o RJ",
    );
  });

  it("skips empty parts", () => {
    expect(
      buildProfileEmbeddingText({
        products: ["papel"],
        keywords: [],
        notes: "   ",
      }),
    ).toBe("produtos: papel");
  });

  it("returns an empty string when everything is empty", () => {
    expect(
      buildProfileEmbeddingText({ products: [], keywords: [], notes: "" }),
    ).toBe("");
  });
});

describe("embedText", () => {
  it("returns the vector and the model used", async () => {
    const create = vi
      .fn()
      .mockResolvedValue({ data: [{ embedding: [0.1, 0.2] }] });

    const out = await embedText("material escolar", {
      client: fakeClient(create),
      model: "text-embedding-3-small",
    });

    expect(out).toEqual({ vector: [0.1, 0.2], model: "text-embedding-3-small" });
    expect(create).toHaveBeenCalledWith({
      model: "text-embedding-3-small",
      input: "material escolar",
    });
  });

  it("returns null for empty text without calling the SDK", async () => {
    const create = vi.fn();
    expect(await embedText("   ", { client: fakeClient(create) })).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  it("returns null and warns when the SDK throws", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const create = vi.fn().mockRejectedValue(new Error("401"));

    expect(await embedText("papel", { client: fakeClient(create) })).toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it("returns null and warns when the response has no embedding", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const create = vi.fn().mockResolvedValue({ data: [] });

    expect(await embedText("papel", { client: fakeClient(create) })).toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it("returns null and warns when no API key is configured", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const before = {
      lixto: process.env.LIXTO_LLM_API_KEY,
      openai: process.env.OPENAI_API_KEY,
    };
    delete process.env.LIXTO_LLM_API_KEY;
    delete process.env.OPENAI_API_KEY;

    try {
      expect(await embedText("papel")).toBeNull();
      expect(warn).toHaveBeenCalled();
    } finally {
      if (before.lixto !== undefined) process.env.LIXTO_LLM_API_KEY = before.lixto;
      if (before.openai !== undefined) process.env.OPENAI_API_KEY = before.openai;
    }
  });
});
