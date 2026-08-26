import { beforeEach, describe, expect, it, vi } from "vitest";

// Relative imports (not "@/lib/...") on purpose: vitest runs without a config
// file. Persistence and the tool layer are both mocked, which also keeps
// `db.ts` (and its pool) out of the module graph.
vi.mock("./conversation-queries", () => ({
  createConversation: vi.fn(),
  getConversation: vi.fn(),
  listConversations: vi.fn(),
  appendMessage: vi.fn(),
  listMessages: vi.fn(),
  touchConversation: vi.fn(),
  getCompanySize: vi.fn(),
  recordChatRun: vi.fn(),
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
  appendMessage,
  createConversation,
  getCompanySize,
  getConversation,
  listMessages,
  recordChatRun,
  touchConversation,
} from "./conversation-queries";
import { ConversationNotFound, MAX_ROUNDS, runChat, SYSTEM_PROMPT } from "./run";
import type { ProcurementRef, ToolResult } from "./types";

const mock = <T>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

const SESSION: Session = {
  user: {
    id: 3,
    name: "Ana",
    email: "ana@alfa.com",
    role: "admin",
    companyId: 7,
  },
  company: {
    id: 7,
    legalName: "Alfa Comércio Ltda",
    tradeName: "Alfa",
    taxId: "12345678000199",
  },
};

const SOURCE_ID = "12345678000199-1-000123/2026";
const OTHER = "12345678000199-1-000124/2026";

function ref(sourceId: string): ProcurementRef {
  return {
    source_id: sourceId,
    description: "lápis",
    agency: null,
    state: "RJ",
    city: null,
    modality: null,
    estimated_value: null,
    closes_at: null,
    status: "open",
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

const conversation = {
  id: 10,
  company_id: 7,
  user_id: 3,
  title: null,
  created_at: "",
  updated_at: "",
};

beforeEach(() => {
  vi.clearAllMocks();
  mock(createConversation).mockResolvedValue(conversation);
  mock(getConversation).mockResolvedValue(conversation);
  mock(listMessages).mockResolvedValue([]);
  mock(appendMessage).mockResolvedValue({});
  mock(touchConversation).mockResolvedValue(undefined);
  mock(getCompanySize).mockResolvedValue("ME");
  mock(recordChatRun).mockResolvedValue(undefined);
});

/** Rows handed to `appendMessage`, in insertion order. */
function persisted() {
  return mock(appendMessage).mock.calls.map(
    (call: unknown[]) => call[1] as Record<string, unknown>,
  );
}

describe("runChat: tool round", () => {
  it("executes the call with the session's company and returns the second reply", async () => {
    const execute = vi.fn<(...a: unknown[]) => Promise<ToolResult>>();
    execute.mockResolvedValue({
      ok: true,
      data: { total: 2 },
      // Same ref twice plus a second one: dedupe keeps first-seen order.
      refs: [ref(SOURCE_ID), ref(OTHER), ref(SOURCE_ID)],
    });
    const { client, create } = fakeClient(
      toolCallReply("call_1", "search_procurements", '{"q":"lápis"}'),
      reply({ content: "1. Lápis A\n2. Lápis B" }),
    );

    const out = await runChat(
      { conversationId: null, text: "lápis no RJ" },
      SESSION,
      { client, model: "fake-model", execute: execute as never },
    );

    expect(createConversation).toHaveBeenCalledWith(7, 3, "lápis no RJ");
    expect(execute).toHaveBeenCalledWith(
      "search_procurements",
      { q: "lápis" },
      { companyId: 7, size: "ME", companyName: "Alfa" },
    );
    expect(out.answer).toBe("1. Lápis A\n2. Lápis B");
    expect(out.refs.map((r) => r.source_id)).toEqual([SOURCE_ID, OTHER]);
    expect(out.toolCalls).toEqual([
      { name: "search_procurements", args: { q: "lápis" } },
    ]);
    expect(create).toHaveBeenCalledTimes(2);
    expect(touchConversation).toHaveBeenCalledWith(10);

    const rows = persisted();
    expect(rows.map((r) => r.role)).toEqual([
      "user",
      "assistant",
      "tool",
      "assistant",
    ]);
    expect(rows[1].tool_calls).toEqual([
      { id: "call_1", name: "search_procurements", arguments: '{"q":"lápis"}' },
    ]);
    expect(rows[2]).toMatchObject({
      tool_call_id: "call_1",
      content: JSON.stringify({ total: 2 }),
    });
    expect(rows[3].refs).toBe(out.refs);
  });

  it("records one agent_runs chat row with the round/tool counters", async () => {
    const execute = vi.fn().mockResolvedValue({ ok: true, data: {}, refs: [] });
    const { client } = fakeClient(
      toolCallReply("call_1", "search_procurements", "{}"),
      reply({ content: "pronto" }),
    );

    await runChat({ conversationId: 10, text: "?" }, SESSION, {
      client,
      execute: execute as never,
    });

    expect(recordChatRun).toHaveBeenCalledTimes(1);
    expect(recordChatRun).toHaveBeenCalledWith(7, { rounds: 2, tool_calls: 1 });
  });

  it("persists a failed tool as an error payload without collecting refs", async () => {
    const execute = vi
      .fn()
      .mockResolvedValue({ ok: false, error: "falha ao consultar" });
    const { client } = fakeClient(
      toolCallReply("call_9", "search_procurements", "{}"),
      reply({ content: "Não encontrei." }),
    );

    const out = await runChat({ conversationId: 10, text: "?" }, SESSION, {
      client,
      execute: execute as never,
    });

    expect(getConversation).toHaveBeenCalledWith(10, 3);
    expect(out.refs).toEqual([]);
    expect(persisted()[2].content).toBe(
      JSON.stringify({ error: "falha ao consultar" }),
    );
  });
});

describe("runChat: prompt assembly", () => {
  it("appends the active filters to the user's content", async () => {
    const { client, create } = fakeClient(reply({ content: "ok" }));
    await runChat(
      {
        conversationId: null,
        text: "quais combinam?",
        filters: {
          states: ["RJ", "SP"],
          statuses: ["open"],
          valueMin: 100000,
          valueMax: 500000,
        },
      },
      SESSION,
      { client },
    );

    const expected =
      "quais combinam?\n[filtros ativos: uf=RJ,SP; status=open; valor=100000–500000]";
    expect(persisted()[0].content).toBe(expected);
    const sent = create.mock.calls[0][0].messages;
    expect(sent[0]).toEqual({
      role: "system",
      content: SYSTEM_PROMPT({ companyId: 7, size: "ME", companyName: "Alfa" }),
    });
    expect(sent.at(-1)).toEqual({ role: "user", content: expected });
  });

  it("replays persisted history, dropping tool rows orphaned by the window", async () => {
    mock(listMessages).mockResolvedValue([
      // Orphan: its assistant row fell outside the 20-message window.
      { role: "tool", content: "{}", tool_call_id: "call_old" },
      { role: "user", content: "e a segunda?" },
      { role: "assistant", content: "A segunda é…", tool_calls: null },
    ]);
    const { client, create } = fakeClient(reply({ content: "ok" }));
    await runChat({ conversationId: 10, text: "e a terceira?" }, SESSION, {
      client,
    });

    const sent = create.mock.calls[0][0].messages;
    expect(sent.map((m: { role: string }) => m.role)).toEqual([
      "system",
      "user",
      "assistant",
      "user",
    ]);
  });
});

describe("SYSTEM_PROMPT", () => {
  it("mentions list_opportunities and explain_opportunity for 'o que encontrou hoje' / 'por que essa'", () => {
    const prompt = SYSTEM_PROMPT({ companyId: 7, size: "ME", companyName: "Alfa" });
    expect(prompt).toContain("list_opportunities");
    expect(prompt).toContain("explain_opportunity");
  });
});

describe("runChat: guards", () => {
  it("throws ConversationNotFound for another user's thread", async () => {
    mock(getConversation).mockResolvedValue(null);
    const { client, create } = fakeClient();
    await expect(
      runChat({ conversationId: 99, text: "oi" }, SESSION, { client }),
    ).rejects.toBeInstanceOf(ConversationNotFound);
    expect(create).not.toHaveBeenCalled();
    expect(appendMessage).not.toHaveBeenCalled();
  });

  it("gives up after MAX_ROUNDS of tool calls", async () => {
    const execute = vi.fn().mockResolvedValue({ ok: true, data: {}, refs: [] });
    const replies = Array.from({ length: MAX_ROUNDS }, (_, i) =>
      toolCallReply(`call_${i}`, "search_procurements", "{}"),
    );
    const { client, create } = fakeClient(...replies);

    const out = await runChat({ conversationId: 10, text: "loop" }, SESSION, {
      client,
      execute: execute as never,
    });

    expect(create).toHaveBeenCalledTimes(MAX_ROUNDS);
    expect(out.answer).toBe("Não consegui concluir a consulta; tente reformular.");
    expect(persisted().at(-1)).toMatchObject({
      role: "assistant",
      content: out.answer,
    });
  });

  it("rethrows SDK errors, after recording a failed run, so the route can answer 502", async () => {
    const create = vi.fn().mockRejectedValue(new Error("429 rate limited"));
    const client = { chat: { completions: { create } } } as unknown as OpenAI;
    await expect(
      runChat({ conversationId: 10, text: "oi" }, SESSION, { client }),
    ).rejects.toThrow("429 rate limited");
    expect(recordChatRun).toHaveBeenCalledWith(
      7,
      { rounds: 1, tool_calls: 0 },
      "failed",
      "429 rate limited",
    );
  });
});
