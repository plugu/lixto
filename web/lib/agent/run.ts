// The conversation runtime: user message → model with tools → tool execution
// → persisted answer, plus one `agent_runs` row per turn.
//
// Shortcut kept from cycle 16 (documented in the ticket): no streaming. One
// request in, one JSON reply out. The tool loop is short enough that a single
// round-trip is acceptable, and SSE would double the UI's surface area.
//
// Relative imports (not "@/lib/...") on purpose: vitest runs without a config
// file, so the tsconfig "@/" alias is not resolvable from lib tests.

import type OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";

import type { Session } from "../auth";
import {
  appendMessage,
  createConversation,
  getCompanySize,
  getConversation,
  listMessages,
  recordChatRun,
  touchConversation,
  type Message,
  type MessageToolCall,
} from "./conversation-queries";
import { CHAT_MODEL, getChatClient } from "./llm";
import { executeTool, TOOL_DEFINITIONS } from "./tools";
import type { ProcurementRef, ToolContext } from "./types";

export type RunFilters = {
  states?: string[];
  statuses?: string[];
  valueMin?: number;
  valueMax?: number;
  modalityIds?: number[];
};

export type RunInput = {
  conversationId: number | null;
  text: string;
  filters?: RunFilters;
};

export type RunOutput = {
  conversationId: number;
  answer: string;
  refs: ProcurementRef[];
  toolCalls: { name: string; args: unknown }[];
};

export type RunDeps = {
  client?: OpenAI;
  model?: string;
  execute?: typeof executeTool;
};

/** Thrown when `conversationId` does not exist *for this user*. The route maps
 * it to 404 — deliberately indistinguishable from "never existed". */
export class ConversationNotFound extends Error {
  constructor() {
    super("conversation not found");
    this.name = "ConversationNotFound";
  }
}

/** Tool rounds before we give up. Six covers "search → detail → analyze" plus
 * one recovery from a failed call; beyond that the model is looping. */
export const MAX_ROUNDS = 6;

/** History replayed into the prompt. Older turns stay in the DB for the UI. */
export const HISTORY_LIMIT = 20;

const MAX_TOOL_CHARS = 20_000;
const MAX_TITLE = 80;

const GAVE_UP = "Não consegui concluir a consulta; tente reformular.";

export function SYSTEM_PROMPT(ctx: ToolContext): string {
  return [
    `Você é o Lixto, agente de licitações públicas de ${ctx.companyName} (porte ${ctx.size ?? "não informado"}).`,
    "Responda em português, de forma direta.",
    "Use as ferramentas para buscar e analisar licitações — nunca invente números de controle, valores ou prazos: só cite o que veio das ferramentas.",
    "Ao listar licitações, numere-as (1., 2., …) na mesma ordem retornada, para o usuário poder dizer 'a segunda'.",
    "Quando perguntarem o que dá para participar / o que combina, use search_my_matches ou calculate_match e explique os motivos pelo código (cnae, termos, uf, valor, me/epp, exclusão).",
    "Se o perfil de match não estiver configurado, diga como configurar em /company/profile.",
    "Para 'o que você encontrou hoje', 'oportunidades' ou 'por que essa', use list_opportunities e explain_opportunity — o resumo diário é a fonte da verdade para 'hoje'.",
  ].join(" ");
}

const CHAT_TOOLS: ChatCompletionTool[] = TOOL_DEFINITIONS.map((t) => ({
  type: "function",
  function: {
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  },
}));

/** Quick filter chips are accelerators, not a filter panel (PRODUCT.md): they
 * ride along as a trailing line of the user's own message so the model may
 * still override them when the sentence says otherwise. */
export function filtersLine(filters: RunFilters | undefined): string {
  if (!filters) return "";
  const parts: string[] = [];
  if (filters.states?.length) parts.push(`uf=${filters.states.join(",")}`);
  if (filters.statuses?.length) parts.push(`status=${filters.statuses.join(",")}`);
  if (filters.modalityIds?.length) {
    parts.push(`modalidade=${filters.modalityIds.join(",")}`);
  }
  const { valueMin, valueMax } = filters;
  if (valueMin != null && valueMax != null) {
    parts.push(`valor=${valueMin}–${valueMax}`);
  } else if (valueMin != null) {
    parts.push(`valor=a partir de ${valueMin}`);
  } else if (valueMax != null) {
    parts.push(`valor=até ${valueMax}`);
  }
  return parts.length ? `\n[filtros ativos: ${parts.join("; ")}]` : "";
}

function toToolCallParam(call: MessageToolCall) {
  return {
    id: call.id,
    type: "function" as const,
    function: { name: call.name, arguments: call.arguments },
  };
}

/**
 * Replays persisted rows as OpenAI messages. Drops orphans: an `assistant`
 * row whose tool answers fell outside the history window (or a `tool` row
 * whose assistant did) makes the API reject the whole request, and the window
 * cuts at an arbitrary point.
 */
export function toChatMessages(rows: Message[]): ChatCompletionMessageParam[] {
  const answered = new Set(
    rows.filter((r) => r.role === "tool" && r.tool_call_id).map((r) => r.tool_call_id!),
  );
  const kept = new Set<string>();
  const messages: ChatCompletionMessageParam[] = [];

  for (const row of rows) {
    if (row.role === "user") {
      messages.push({ role: "user", content: row.content ?? "" });
    } else if (row.role === "assistant") {
      const calls = row.tool_calls ?? [];
      if (calls.length === 0) {
        messages.push({ role: "assistant", content: row.content ?? "" });
      } else if (calls.every((c) => answered.has(c.id))) {
        calls.forEach((c) => kept.add(c.id));
        messages.push({
          role: "assistant",
          content: row.content ?? null,
          tool_calls: calls.map(toToolCallParam),
        });
      }
    } else if (row.tool_call_id && kept.has(row.tool_call_id)) {
      messages.push({
        role: "tool",
        tool_call_id: row.tool_call_id,
        content: row.content ?? "",
      });
    }
  }
  return messages;
}

function pushRefs(into: ProcurementRef[], seen: Set<string>, refs: ProcurementRef[]) {
  for (const ref of refs) {
    if (seen.has(ref.source_id)) continue;
    seen.add(ref.source_id);
    into.push(ref);
  }
}

function parseArgs(raw: string): { ok: true; args: unknown } | { ok: false } {
  try {
    return { ok: true, args: JSON.parse(raw || "{}") };
  } catch {
    return { ok: false };
  }
}

export async function runChat(
  input: RunInput,
  session: Session,
  deps: RunDeps = {},
): Promise<RunOutput> {
  const userId = session.user.id;
  const companyId = session.company.id;

  const conversation =
    input.conversationId === null
      ? await createConversation(
          companyId,
          userId,
          input.text.slice(0, MAX_TITLE),
        )
      : await getConversation(input.conversationId, userId);
  if (!conversation) throw new ConversationNotFound();

  const ctx: ToolContext = {
    companyId,
    size: await getCompanySize(companyId),
    companyName: session.company.tradeName ?? session.company.legalName,
  };

  const userContent = input.text + filtersLine(input.filters);
  const history = await listMessages(conversation.id, HISTORY_LIMIT);
  await appendMessage(conversation.id, { role: "user", content: userContent });

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT(ctx) },
    ...toChatMessages(history),
    { role: "user", content: userContent },
  ];

  const model = deps.model ?? CHAT_MODEL;
  const execute = deps.execute ?? executeTool;

  const refs: ProcurementRef[] = [];
  const seen = new Set<string>();
  const toolCalls: { name: string; args: unknown }[] = [];
  let rounds = 0;

  const counters = () => ({ rounds, tool_calls: toolCalls.length });

  try {
    // Inside the try: the SDK constructor throws when no key is configured,
    // and that is still a chat run worth recording in `agent_runs`.
    const client = deps.client ?? getChatClient();

    for (let round = 0; round < MAX_ROUNDS; round++) {
      rounds++;
      const completion = await client.chat.completions.create({
        model,
        messages,
        tools: CHAT_TOOLS,
        tool_choice: "auto",
      });
      const reply = completion.choices?.[0]?.message;
      const calls = (reply?.tool_calls ?? []).filter(
        (c): c is Extract<typeof c, { function: unknown }> => "function" in c,
      );

      if (calls.length === 0) {
        const answer = reply?.content?.trim() || GAVE_UP;
        await appendMessage(conversation.id, {
          role: "assistant",
          content: answer,
          refs,
          model,
        });
        await touchConversation(conversation.id);
        await recordChatRun(companyId, counters());
        return { conversationId: conversation.id, answer, refs, toolCalls };
      }

      const persisted: MessageToolCall[] = calls.map((c) => ({
        id: c.id,
        name: c.function.name,
        arguments: c.function.arguments,
      }));
      await appendMessage(conversation.id, {
        role: "assistant",
        content: reply?.content ?? null,
        tool_calls: persisted,
        model,
      });
      messages.push({
        role: "assistant",
        content: reply?.content ?? null,
        tool_calls: persisted.map(toToolCallParam),
      });

      for (const call of persisted) {
        const parsed = parseArgs(call.arguments);
        const result = parsed.ok
          ? await execute(call.name, parsed.args, ctx)
          : ({ ok: false, error: "argumentos inválidos" } as const);
        toolCalls.push({ name: call.name, args: parsed.ok ? parsed.args : null });
        if (result.ok) pushRefs(refs, seen, result.refs);

        const content = JSON.stringify(
          result.ok ? result.data : { error: result.error },
        ).slice(0, MAX_TOOL_CHARS);
        await appendMessage(conversation.id, {
          role: "tool",
          content,
          tool_call_id: call.id,
        });
        messages.push({ role: "tool", tool_call_id: call.id, content });
      }
    }
  } catch (err) {
    await recordChatRun(
      companyId,
      counters(),
      "failed",
      err instanceof Error ? err.message.slice(0, 500) : String(err),
    );
    throw err;
  }

  await appendMessage(conversation.id, {
    role: "assistant",
    content: GAVE_UP,
    refs,
    model,
  });
  await touchConversation(conversation.id);
  await recordChatRun(companyId, counters());
  return { conversationId: conversation.id, answer: GAVE_UP, refs, toolCalls };
}
