import { beforeEach, describe, expect, it, vi } from "vitest";

// Relative imports (not "@/lib/...") on purpose: vitest runs without a config
// file. The pool is mocked — these tests never touch a live database.
vi.mock("../db", () => ({ pool: { query: vi.fn() } }));

import { pool } from "../db";
import {
  appendMessage,
  createConversation,
  getCompanySize,
  getConversation,
  listConversations,
  listMessages,
  recordChatRun,
  touchConversation,
} from "./conversation-queries";

const query = pool.query as unknown as ReturnType<typeof vi.fn>;

function conversationRow(over: Record<string, unknown> = {}) {
  return {
    id: "10",
    company_id: "7",
    user_id: "3",
    title: "lápis no RJ",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...over,
  };
}

function messageRow(over: Record<string, unknown> = {}) {
  return {
    id: "1",
    conversation_id: "10",
    role: "user",
    content: "oi",
    tool_calls: null,
    tool_call_id: null,
    refs: null,
    model: null,
    created_at: "2026-01-01T00:00:00Z",
    ...over,
  };
}

beforeEach(() => {
  query.mockReset();
});

describe("createConversation", () => {
  it("inserts with company/user and returns numeric ids", async () => {
    query.mockResolvedValueOnce({ rows: [conversationRow()] });
    const conversation = await createConversation(7, 3, "lápis no RJ");
    expect(query.mock.calls[0][1]).toEqual([7, 3, "lápis no RJ"]);
    expect(conversation).toMatchObject({ id: 10, company_id: 7, user_id: 3 });
  });
});

describe("getConversation", () => {
  it("binds userId so another user's thread is invisible", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const conversation = await getConversation(10, 99);
    const [sql, values] = query.mock.calls[0];
    expect(sql).toContain("user_id = $2");
    expect(values).toEqual([10, 99]);
    expect(conversation).toBeNull();
  });

  it("returns the row when it belongs to the user", async () => {
    query.mockResolvedValueOnce({ rows: [conversationRow()] });
    expect(await getConversation(10, 3)).toMatchObject({ id: 10, user_id: 3 });
  });
});

describe("listConversations", () => {
  it("scopes by user and defaults to 20", async () => {
    query.mockResolvedValueOnce({ rows: [conversationRow()] });
    const rows = await listConversations(3);
    expect(query.mock.calls[0][1]).toEqual([3, 20]);
    expect(rows).toHaveLength(1);
  });
});

describe("appendMessage", () => {
  it("serializes the JSON columns and defaults the optional ones", async () => {
    query.mockResolvedValueOnce({ rows: [messageRow({ role: "assistant" })] });
    const toolCalls = [{ id: "call_1", name: "get_procurement", arguments: "{}" }];
    const refs = [{ source_id: "x", description: null }];
    await appendMessage(10, {
      role: "assistant",
      content: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tool_calls: toolCalls as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      refs: refs as any,
      model: "gpt-5-mini",
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
    query.mockResolvedValueOnce({ rows: [messageRow({ role: "tool" })] });
    await appendMessage(10, {
      role: "tool",
      content: "{}",
      tool_call_id: "call_1",
    });
    const values = query.mock.calls[0][1];
    expect(values[3]).toBeNull();
    expect(values[4]).toBe("call_1");
    expect(values[5]).toBeNull();
  });
});

describe("listMessages", () => {
  it("returns oldest first with numeric ids", async () => {
    query.mockResolvedValueOnce({
      rows: [messageRow({ id: "1" }), messageRow({ id: "2" })],
    });
    const rows = await listMessages(10, 5);
    const [sql, values] = query.mock.calls[0];
    expect(sql).toContain("ORDER BY id ASC");
    expect(values).toEqual([10, 5]);
    expect(rows.map((r) => r.id)).toEqual([1, 2]);
  });
});

describe("touchConversation / getCompanySize", () => {
  it("touches updated_at", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await touchConversation(10);
    expect(query.mock.calls[0][0]).toContain("UPDATE conversations");
    expect(query.mock.calls[0][1]).toEqual([10]);
  });

  it("returns null when the company has no size", async () => {
    query.mockResolvedValueOnce({ rows: [{ size: null }] });
    expect(await getCompanySize(7)).toBeNull();
    query.mockResolvedValueOnce({ rows: [{ size: "ME" }] });
    expect(await getCompanySize(7)).toBe("ME");
  });
});

describe("recordChatRun", () => {
  it("inserts a done chat run with serialized counters", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await recordChatRun(7, { rounds: 2, tool_calls: 1 });
    const [sql, values] = query.mock.calls[0];
    expect(sql).toContain("INSERT INTO agent_runs");
    expect(sql).toContain("'chat'");
    expect(values).toEqual([7, "done", JSON.stringify({ rounds: 2, tool_calls: 1 }), null]);
  });

  it("records a failed run with its error", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await recordChatRun(7, { rounds: 1, tool_calls: 0 }, "failed", "429");
    const values = query.mock.calls[0][1];
    expect(values[1]).toBe("failed");
    expect(values[3]).toBe("429");
  });
});
