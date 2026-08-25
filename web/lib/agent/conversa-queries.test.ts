import { beforeEach, describe, expect, it, vi } from "vitest";

// Relative imports (not "@/lib/...") on purpose: vitest runs without a config
// file. The pool is mocked — these tests never touch a live database.
vi.mock("../db", () => ({ pool: { query: vi.fn() } }));

import { pool } from "../db";
import {
  appendMensagem,
  createConversa,
  getConversa,
  getEmpresaPorte,
  listConversas,
  listMensagens,
  touchConversa,
} from "./conversa-queries";

const query = pool.query as unknown as ReturnType<typeof vi.fn>;

function conversaRow(over: Record<string, unknown> = {}) {
  return {
    id: "10",
    empresa_id: "7",
    usuario_id: "3",
    titulo: "lápis no RJ",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...over,
  };
}

function mensagemRow(over: Record<string, unknown> = {}) {
  return {
    id: "1",
    conversa_id: "10",
    role: "user",
    conteudo: "oi",
    tool_calls: null,
    tool_call_id: null,
    refs: null,
    modelo: null,
    created_at: "2026-01-01T00:00:00Z",
    ...over,
  };
}

beforeEach(() => {
  query.mockReset();
});

describe("createConversa", () => {
  it("inserts with empresa/usuario and returns numeric ids", async () => {
    query.mockResolvedValueOnce({ rows: [conversaRow()] });
    const conversa = await createConversa(7, 3, "lápis no RJ");
    expect(query.mock.calls[0][1]).toEqual([7, 3, "lápis no RJ"]);
    expect(conversa).toMatchObject({ id: 10, empresa_id: 7, usuario_id: 3 });
  });
});

describe("getConversa", () => {
  it("binds usuarioId so another user's thread is invisible", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const conversa = await getConversa(10, 99);
    const [sql, values] = query.mock.calls[0];
    expect(sql).toContain("usuario_id = $2");
    expect(values).toEqual([10, 99]);
    expect(conversa).toBeNull();
  });

  it("returns the row when it belongs to the usuario", async () => {
    query.mockResolvedValueOnce({ rows: [conversaRow()] });
    expect(await getConversa(10, 3)).toMatchObject({ id: 10, usuario_id: 3 });
  });
});

describe("listConversas", () => {
  it("scopes by usuario and defaults to 20", async () => {
    query.mockResolvedValueOnce({ rows: [conversaRow()] });
    const rows = await listConversas(3);
    expect(query.mock.calls[0][1]).toEqual([3, 20]);
    expect(rows).toHaveLength(1);
  });
});

describe("appendMensagem", () => {
  it("serializes the JSON columns and defaults the optional ones", async () => {
    query.mockResolvedValueOnce({ rows: [mensagemRow({ role: "assistant" })] });
    const toolCalls = [{ id: "call_1", name: "get_procurement", arguments: "{}" }];
    const refs = [{ numero_controle_pncp: "x", objeto: null }];
    await appendMensagem(10, {
      role: "assistant",
      conteudo: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tool_calls: toolCalls as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      refs: refs as any,
      modelo: "gpt-5-mini",
    });
    const values = query.mock.calls[0][1];
    expect(values[0]).toBe(10);
    expect(values[1]).toBe("assistant");
    expect(values[2]).toBeNull();
    expect(values[3]).toBe(JSON.stringify(toolCalls));
    expect(values[4]).toBeNull();
    expect(values[5]).toBe(JSON.stringify(refs));
    expect(values[6]).toBe("gpt-5-mini");
  });

  it("keeps tool rows' tool_call_id and leaves JSON columns null", async () => {
    query.mockResolvedValueOnce({ rows: [mensagemRow({ role: "tool" })] });
    await appendMensagem(10, {
      role: "tool",
      conteudo: "{}",
      tool_call_id: "call_1",
    });
    const values = query.mock.calls[0][1];
    expect(values[3]).toBeNull();
    expect(values[4]).toBe("call_1");
    expect(values[5]).toBeNull();
  });
});

describe("listMensagens", () => {
  it("returns oldest first with numeric ids", async () => {
    query.mockResolvedValueOnce({
      rows: [mensagemRow({ id: "1" }), mensagemRow({ id: "2" })],
    });
    const rows = await listMensagens(10, 5);
    const [sql, values] = query.mock.calls[0];
    expect(sql).toContain("ORDER BY id ASC");
    expect(values).toEqual([10, 5]);
    expect(rows.map((r) => r.id)).toEqual([1, 2]);
  });
});

describe("touchConversa / getEmpresaPorte", () => {
  it("touches updated_at", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await touchConversa(10);
    expect(query.mock.calls[0][0]).toContain("UPDATE conversa");
    expect(query.mock.calls[0][1]).toEqual([10]);
  });

  it("returns null when the empresa has no porte", async () => {
    query.mockResolvedValueOnce({ rows: [{ porte: null }] });
    expect(await getEmpresaPorte(7)).toBeNull();
    query.mockResolvedValueOnce({ rows: [{ porte: "ME" }] });
    expect(await getEmpresaPorte(7)).toBe("ME");
  });
});
