import { beforeEach, describe, expect, it, vi } from "vitest";

// Relative imports (not "@/lib/...") on purpose: vitest runs without a config
// file. Persistence and the tool layer are both mocked, which also keeps
// `db.ts` (and its pool) out of the module graph.
vi.mock("./conversa-queries", () => ({
  createConversa: vi.fn(),
  getConversa: vi.fn(),
  listConversas: vi.fn(),
  appendMensagem: vi.fn(),
  listMensagens: vi.fn(),
  touchConversa: vi.fn(),
  getEmpresaPorte: vi.fn(),
}));
vi.mock("./tools", () => ({
  TOOL_DEFINITIONS: [
    { name: "search_procurements", description: "busca", parameters: {} },
  ],
  executeTool: vi.fn(),
}));

import type OpenAI from "openai";

import type { Session } from "../auth";
import {
  appendMensagem,
  createConversa,
  getConversa,
  getEmpresaPorte,
  listMensagens,
  touchConversa,
} from "./conversa-queries";
import { ConversaNotFound, MAX_ROUNDS, runChat, SYSTEM_PROMPT } from "./run";
import type { LicitacaoRef, ToolResult } from "./types";

const mock = <T>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

const SESSION: Session = {
  usuario: {
    id: 3,
    nome: "Ana",
    email: "ana@alfa.com",
    role: "admin",
    empresaId: 7,
  },
  empresa: {
    id: 7,
    razaoSocial: "Alfa Comércio Ltda",
    nomeFantasia: "Alfa",
    cnpj: "12345678000199",
  },
};

const NUMERO = "12345678000199-1-000123/2026";
const OUTRO = "12345678000199-1-000124/2026";

function ref(numero: string): LicitacaoRef {
  return {
    numero_controle_pncp: numero,
    objeto: "lápis",
    orgao: null,
    uf: "RJ",
    municipio: null,
    modalidade: null,
    valor_estimado: null,
    encerramento: null,
    status: "aberta",
  };
}

/** One `chat.completions.create` reply, scripted per call. */
function reply(message: Record<string, unknown>) {
  return { choices: [{ message }] };
}

function toolCallReply(id: string, name: string, args: string) {
  return reply({
    content: null,
    tool_calls: [{ id, type: "function", function: { name, arguments: args } }],
  });
}

function fakeClient(...replies: unknown[]) {
  const create = vi.fn();
  for (const r of replies) create.mockResolvedValueOnce(r);
  return {
    client: { chat: { completions: { create } } } as unknown as OpenAI,
    create,
  };
}

const conversa = {
  id: 10,
  empresa_id: 7,
  usuario_id: 3,
  titulo: null,
  created_at: "",
  updated_at: "",
};

beforeEach(() => {
  vi.clearAllMocks();
  mock(createConversa).mockResolvedValue(conversa);
  mock(getConversa).mockResolvedValue(conversa);
  mock(listMensagens).mockResolvedValue([]);
  mock(appendMensagem).mockResolvedValue({});
  mock(touchConversa).mockResolvedValue(undefined);
  mock(getEmpresaPorte).mockResolvedValue("ME");
});

/** Rows handed to `appendMensagem`, in insertion order. */
function persisted() {
  return mock(appendMensagem).mock.calls.map(
    (call: unknown[]) => call[1] as Record<string, unknown>,
  );
}

describe("runChat: tool round", () => {
  it("executes the call with the session's empresa and returns the second reply", async () => {
    const execute = vi.fn<(...a: unknown[]) => Promise<ToolResult>>();
    execute.mockResolvedValue({
      ok: true,
      data: { total: 2 },
      // Same ref twice plus a second one: dedupe keeps first-seen order.
      refs: [ref(NUMERO), ref(OUTRO), ref(NUMERO)],
    });
    const { client, create } = fakeClient(
      toolCallReply("call_1", "search_procurements", '{"termo":"lápis"}'),
      reply({ content: "1. Lápis A\n2. Lápis B" }),
    );

    const out = await runChat({ conversaId: null, texto: "lápis no RJ" }, SESSION, {
      client,
      model: "fake-model",
      execute: execute as never,
    });

    expect(createConversa).toHaveBeenCalledWith(7, 3, "lápis no RJ");
    expect(execute).toHaveBeenCalledWith(
      "search_procurements",
      { termo: "lápis" },
      { empresaId: 7, porte: "ME", empresaNome: "Alfa" },
    );
    expect(out.resposta).toBe("1. Lápis A\n2. Lápis B");
    expect(out.refs.map((r) => r.numero_controle_pncp)).toEqual([NUMERO, OUTRO]);
    expect(out.toolCalls).toEqual([
      { name: "search_procurements", args: { termo: "lápis" } },
    ]);
    expect(create).toHaveBeenCalledTimes(2);
    expect(touchConversa).toHaveBeenCalledWith(10);

    const rows = persisted();
    expect(rows.map((r) => r.role)).toEqual([
      "user",
      "assistant",
      "tool",
      "assistant",
    ]);
    expect(rows[1].tool_calls).toEqual([
      { id: "call_1", name: "search_procurements", arguments: '{"termo":"lápis"}' },
    ]);
    expect(rows[2]).toMatchObject({
      tool_call_id: "call_1",
      conteudo: JSON.stringify({ total: 2 }),
    });
    expect(rows[3].refs).toBe(out.refs);
  });

  it("persists a failed tool as an erro payload without collecting refs", async () => {
    const execute = vi.fn().mockResolvedValue({ ok: false, erro: "falha ao consultar" });
    const { client } = fakeClient(
      toolCallReply("call_9", "search_procurements", "{}"),
      reply({ content: "Não encontrei." }),
    );

    const out = await runChat({ conversaId: 10, texto: "?" }, SESSION, {
      client,
      execute: execute as never,
    });

    expect(getConversa).toHaveBeenCalledWith(10, 3);
    expect(out.refs).toEqual([]);
    expect(persisted()[2].conteudo).toBe(
      JSON.stringify({ erro: "falha ao consultar" }),
    );
  });
});

describe("runChat: prompt assembly", () => {
  it("appends the active filters to the user's content", async () => {
    const { client, create } = fakeClient(reply({ content: "ok" }));
    await runChat(
      {
        conversaId: null,
        texto: "quais combinam?",
        filtros: {
          ufs: ["RJ", "SP"],
          statuses: ["aberta"],
          valorMin: 100000,
          valorMax: 500000,
        },
      },
      SESSION,
      { client },
    );

    const esperado =
      "quais combinam?\n[filtros ativos: uf=RJ,SP; status=aberta; valor=100000–500000]";
    expect(persisted()[0].conteudo).toBe(esperado);
    const sent = create.mock.calls[0][0].messages;
    expect(sent[0]).toEqual({ role: "system", content: SYSTEM_PROMPT({
      empresaId: 7,
      porte: "ME",
      empresaNome: "Alfa",
    }) });
    expect(sent.at(-1)).toEqual({ role: "user", content: esperado });
  });

  it("replays persisted history, dropping tool rows orphaned by the window", async () => {
    mock(listMensagens).mockResolvedValue([
      // Orphan: its assistant row fell outside the 20-message window.
      { role: "tool", conteudo: "{}", tool_call_id: "call_old" },
      { role: "user", conteudo: "e a segunda?" },
      { role: "assistant", conteudo: "A segunda é…", tool_calls: null },
    ]);
    const { client, create } = fakeClient(reply({ content: "ok" }));
    await runChat({ conversaId: 10, texto: "e a terceira?" }, SESSION, { client });

    const sent = create.mock.calls[0][0].messages;
    expect(sent.map((m: { role: string }) => m.role)).toEqual([
      "system",
      "user",
      "assistant",
      "user",
    ]);
  });
});

describe("runChat: guards", () => {
  it("throws ConversaNotFound for another user's conversa", async () => {
    mock(getConversa).mockResolvedValue(null);
    const { client, create } = fakeClient();
    await expect(
      runChat({ conversaId: 99, texto: "oi" }, SESSION, { client }),
    ).rejects.toBeInstanceOf(ConversaNotFound);
    expect(create).not.toHaveBeenCalled();
    expect(appendMensagem).not.toHaveBeenCalled();
  });

  it("gives up after MAX_ROUNDS of tool calls", async () => {
    const execute = vi.fn().mockResolvedValue({ ok: true, data: {}, refs: [] });
    const replies = Array.from({ length: MAX_ROUNDS }, (_, i) =>
      toolCallReply(`call_${i}`, "search_procurements", "{}"),
    );
    const { client, create } = fakeClient(...replies);

    const out = await runChat({ conversaId: 10, texto: "loop" }, SESSION, {
      client,
      execute: execute as never,
    });

    expect(create).toHaveBeenCalledTimes(MAX_ROUNDS);
    expect(out.resposta).toBe("Não consegui concluir a consulta; tente reformular.");
    expect(persisted().at(-1)).toMatchObject({
      role: "assistant",
      conteudo: out.resposta,
    });
  });

  it("rethrows SDK errors so the route can answer 502", async () => {
    const create = vi.fn().mockRejectedValue(new Error("429 rate limited"));
    const client = { chat: { completions: { create } } } as unknown as OpenAI;
    await expect(
      runChat({ conversaId: 10, texto: "oi" }, SESSION, { client }),
    ).rejects.toThrow("429 rate limited");
  });
});
