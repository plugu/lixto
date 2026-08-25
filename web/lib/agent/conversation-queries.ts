// Persistence for chat conversations (`conversations` / `messages`, ADR 001
// §D5) plus the `agent_runs` row every chat turn records.
//
// Relative imports (not "@/lib/...") on purpose: vitest runs without a config
// file, so the tsconfig "@/" alias is not resolvable from lib tests.
//
// Tenant rule (docs/TENANT.md): `userId` and `companyId` always come from the
// session. `getConversation` binds `user_id` in the WHERE clause instead of
// checking it in JS, so a guessed id reads as "not found".

import { pool } from "../db";
import type { ProcurementRef } from "./types";

export type Conversation = {
  id: number;
  company_id: number;
  user_id: number;
  title: string | null;
  created_at: string;
  updated_at: string;
};

export type MessageRole = "user" | "assistant" | "tool";

/** The assistant-side record of one function call, as stored in `tool_calls`. */
export type MessageToolCall = {
  id: string;
  name: string;
  arguments: string;
};

export type Message = {
  id: number;
  conversation_id: number;
  role: MessageRole;
  content: string | null;
  tool_calls: MessageToolCall[] | null;
  tool_call_id: string | null;
  refs: ProcurementRef[] | null;
  model: string | null;
  created_at: string;
};

export type MessageInput = {
  role: MessageRole;
  content: string | null;
  tool_calls?: MessageToolCall[] | null;
  tool_call_id?: string | null;
  refs?: ProcurementRef[] | null;
  model?: string | null;
};

type ConversationRow = Omit<Conversation, "id" | "company_id" | "user_id"> & {
  id: string;
  company_id: string;
  user_id: string;
};

type MessageRow = Omit<Message, "id" | "conversation_id"> & {
  id: string;
  conversation_id: string;
};

// BIGSERIAL comes back from node-pg as a string; the app talks in numbers.
function toConversation(row: ConversationRow): Conversation {
  return {
    ...row,
    id: Number(row.id),
    company_id: Number(row.company_id),
    user_id: Number(row.user_id),
  };
}

function toMessage(row: MessageRow): Message {
  return { ...row, id: Number(row.id), conversation_id: Number(row.conversation_id) };
}

const CONVERSATION_COLS = `id, company_id, user_id, title, created_at, updated_at`;
const MESSAGE_COLS = `id, conversation_id, role, content, tool_calls, tool_call_id, refs, model, created_at`;

export async function createConversation(
  companyId: number,
  userId: number,
  title: string | null,
): Promise<Conversation> {
  const { rows } = await pool.query<ConversationRow>(
    `INSERT INTO conversations (company_id, user_id, title)
          VALUES ($1, $2, $3)
       RETURNING ${CONVERSATION_COLS}`,
    [companyId, userId, title],
  );
  return toConversation(rows[0]);
}

/** Null unless the conversation belongs to `userId` — both ids are bound. */
export async function getConversation(
  id: number,
  userId: number,
): Promise<Conversation | null> {
  const { rows } = await pool.query<ConversationRow>(
    `SELECT ${CONVERSATION_COLS} FROM conversations WHERE id = $1 AND user_id = $2`,
    [id, userId],
  );
  return rows[0] ? toConversation(rows[0]) : null;
}

export async function listConversations(
  userId: number,
  limit = 20,
): Promise<Conversation[]> {
  const { rows } = await pool.query<ConversationRow>(
    `SELECT ${CONVERSATION_COLS}
       FROM conversations
      WHERE user_id = $1
      ORDER BY updated_at DESC
      LIMIT $2`,
    [userId, limit],
  );
  return rows.map(toConversation);
}

export async function appendMessage(
  conversationId: number,
  msg: MessageInput,
): Promise<Message> {
  const { rows } = await pool.query<MessageRow>(
    `INSERT INTO messages (conversation_id, role, content, tool_calls, tool_call_id, refs, model)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING ${MESSAGE_COLS}`,
    [
      conversationId,
      msg.role,
      msg.content,
      // JSONB columns: node-pg would send a JS array as a Postgres array
      // literal, so serialize explicitly.
      msg.tool_calls ? JSON.stringify(msg.tool_calls) : null,
      msg.tool_call_id ?? null,
      msg.refs ? JSON.stringify(msg.refs) : null,
      msg.model ?? null,
    ],
  );
  return toMessage(rows[0]);
}

/** Oldest first — the order the model expects to replay history in. */
export async function listMessages(
  conversationId: number,
  limit = 40,
): Promise<Message[]> {
  const { rows } = await pool.query<MessageRow>(
    `SELECT ${MESSAGE_COLS} FROM (
       SELECT ${MESSAGE_COLS} FROM messages
        WHERE conversation_id = $1
        ORDER BY id DESC
        LIMIT $2
     ) recent
     ORDER BY id ASC`,
    [conversationId, limit],
  );
  return rows.map(toMessage);
}

export async function touchConversation(id: number): Promise<void> {
  await pool.query(`UPDATE conversations SET updated_at = now() WHERE id = $1`, [
    id,
  ]);
}

/** `companies.size` for the tool context (ME/EPP eligibility). Not on the
 * session because `Session` is shared with pages that don't need it. */
export async function getCompanySize(companyId: number): Promise<string | null> {
  const { rows } = await pool.query<{ size: string | null }>(
    `SELECT size FROM companies WHERE id = $1`,
    [companyId],
  );
  return rows[0]?.size ?? null;
}

export type ChatRunCounters = { rounds: number; tool_calls: number };

/** One `agent_runs` row per chat turn (`kind = 'chat'`), closed immediately:
 * a turn is short enough that a running/finished pair would buy nothing. */
export async function recordChatRun(
  companyId: number,
  counters: ChatRunCounters,
  status: "done" | "failed" = "done",
  error: string | null = null,
): Promise<void> {
  await pool.query(
    `INSERT INTO agent_runs (kind, company_id, status, finished_at, counters, error)
          VALUES ('chat', $1, $2, now(), $3, $4)`,
    [companyId, status, JSON.stringify(counters), error],
  );
}
