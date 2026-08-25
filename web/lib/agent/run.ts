// The conversation runtime (ticket 68): user message → model with tools →
// tool execution (ticket 67) → persisted answer.
//
// MVP shortcut (documented in the ticket): no streaming. One request in, one
// JSON reply out. The tool loop is short enough that a single round-trip is
// acceptable, and SSE would double the surface area of the UI ticket (69).
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
  appendMensagem,
  createConversa,
  getConversa,
  getEmpresaPorte,
  listMensagens,
  touchConversa,
  type Mensagem,
  type MensagemToolCall,
} from "./conversa-queries";
import { CHAT_MODEL, getChatClient } from "./llm";
import { executeTool, TOOL_DEFINITIONS } from "./tools";
import type { LicitacaoRef, ToolContext } from "./types";

export type RunFiltros = {
  ufs?: string[];
  statuses?: string[];
  valorMin?: number;
  valorMax?: number;
  modalidadeIds?: number[];
};

export type RunInput = {
  conversaId: number | null;
  texto: string;
  filtros?: RunFiltros;
};

export type RunOutput = {
  conversaId: number;
  resposta: string;
  refs: LicitacaoRef[];
  toolCalls: { name: string; args: unknown }[];
};

export type RunDeps = {
  client?: OpenAI;
  model?: string;
  execute?: typeof executeTool;
};

/** Thrown when `conversaId` does not exist *for this usuario*. The route maps
 * it to 404 — deliberately indistinguishable from "never existed". */
export class ConversaNotFound extends Error {
  constructor() {
    super("conversa não encontrada");
    this.name = "ConversaNotFound";
  }
}

/** Tool rounds before we give up. Six covers "busca → detalha → analisa" plus
 * one recovery from a failed call; beyond that the model is looping. */
export const MAX_ROUNDS = 6;

/** History replayed into the prompt. Older turns stay in the DB for the UI. */
export const HISTORY_LIMIT = 20;

const MAX_TOOL_CHARS = 20_000;
const MAX_TITULO = 80;

const DESISTIU = "Não consegui concluir a consulta; tente reformular.";

export function SYSTEM_PROMPT(ctx: ToolContext): string {
  return [
    `Você é o Lixto, agente de licitações públicas da empresa ${ctx.empresaNome} (porte ${ctx.porte ?? "não informado"}).`,
    "Responda em português, de forma direta.",
    "Use as ferramentas para buscar e analisar licitações — nunca invente números de controle, valores ou prazos: só cite o que veio das ferramentas.",
    "Ao listar licitações, numere-as (1., 2., …) na mesma ordem retornada, para o usuário poder dizer 'a segunda'.",
    "Quando o usuário perguntar se a empresa pode participar / quais combinam, use search_my_matches ou calculate_match e explique os motivos pelo código (cnae, termos, uf, valor, me/epp, exclusão).",
    "Se o perfil de match não estiver configurado, diga como configurar em /empresa/perfil.",
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
export function filtrosLine(filtros: RunFiltros | undefined): string {
  if (!filtros) return "";
  const parts: string[] = [];
  if (filtros.ufs?.length) parts.push(`uf=${filtros.ufs.join(",")}`);
  if (filtros.statuses?.length) parts.push(`status=${filtros.statuses.join(",")}`);
  if (filtros.modalidadeIds?.length) {
    parts.push(`modalidade=${filtros.modalidadeIds.join(",")}`);
  }
  const { valorMin, valorMax } = filtros;
  if (valorMin != null && valorMax != null) {
    parts.push(`valor=${valorMin}–${valorMax}`);
  } else if (valorMin != null) {
    parts.push(`valor=a partir de ${valorMin}`);
  } else if (valorMax != null) {
    parts.push(`valor=até ${valorMax}`);
  }
  return parts.length ? `\n[filtros ativos: ${parts.join("; ")}]` : "";
}

function toToolCallParam(call: MensagemToolCall) {
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
export function toChatMessages(rows: Mensagem[]): ChatCompletionMessageParam[] {
  const answered = new Set(
    rows.filter((r) => r.role === "tool" && r.tool_call_id).map((r) => r.tool_call_id!),
  );
  const kept = new Set<string>();
  const messages: ChatCompletionMessageParam[] = [];

  for (const row of rows) {
    if (row.role === "user") {
      messages.push({ role: "user", content: row.conteudo ?? "" });
    } else if (row.role === "assistant") {
      const calls = row.tool_calls ?? [];
      if (calls.length === 0) {
        messages.push({ role: "assistant", content: row.conteudo ?? "" });
      } else if (calls.every((c) => answered.has(c.id))) {
        calls.forEach((c) => kept.add(c.id));
        messages.push({
          role: "assistant",
          content: row.conteudo ?? null,
          tool_calls: calls.map(toToolCallParam),
        });
      }
    } else if (row.tool_call_id && kept.has(row.tool_call_id)) {
      messages.push({
        role: "tool",
        tool_call_id: row.tool_call_id,
        content: row.conteudo ?? "",
      });
    }
  }
  return messages;
}

function pushRefs(into: LicitacaoRef[], seen: Set<string>, refs: LicitacaoRef[]) {
  for (const ref of refs) {
    if (seen.has(ref.numero_controle_pncp)) continue;
    seen.add(ref.numero_controle_pncp);
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
  const usuarioId = session.usuario.id;
  const empresaId = session.empresa.id;

  const conversa =
    input.conversaId === null
      ? await createConversa(empresaId, usuarioId, input.texto.slice(0, MAX_TITULO))
      : await getConversa(input.conversaId, usuarioId);
  if (!conversa) throw new ConversaNotFound();

  const ctx: ToolContext = {
    empresaId,
    porte: await getEmpresaPorte(empresaId),
    empresaNome: session.empresa.nomeFantasia ?? session.empresa.razaoSocial,
  };

  const conteudoUsuario = input.texto + filtrosLine(input.filtros);
  const historico = await listMensagens(conversa.id, HISTORY_LIMIT);
  await appendMensagem(conversa.id, { role: "user", conteudo: conteudoUsuario });

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT(ctx) },
    ...toChatMessages(historico),
    { role: "user", content: conteudoUsuario },
  ];

  const client = deps.client ?? getChatClient();
  const model = deps.model ?? CHAT_MODEL;
  const execute = deps.execute ?? executeTool;

  const refs: LicitacaoRef[] = [];
  const seen = new Set<string>();
  const toolCalls: { name: string; args: unknown }[] = [];

  for (let round = 0; round < MAX_ROUNDS; round++) {
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
      const resposta = reply?.content?.trim() || DESISTIU;
      await appendMensagem(conversa.id, {
        role: "assistant",
        conteudo: resposta,
        refs,
        modelo: model,
      });
      await touchConversa(conversa.id);
      return { conversaId: conversa.id, resposta, refs, toolCalls };
    }

    const persistidas: MensagemToolCall[] = calls.map((c) => ({
      id: c.id,
      name: c.function.name,
      arguments: c.function.arguments,
    }));
    await appendMensagem(conversa.id, {
      role: "assistant",
      conteudo: reply?.content ?? null,
      tool_calls: persistidas,
      modelo: model,
    });
    messages.push({
      role: "assistant",
      content: reply?.content ?? null,
      tool_calls: persistidas.map(toToolCallParam),
    });

    for (const call of persistidas) {
      const parsed = parseArgs(call.arguments);
      const result = parsed.ok
        ? await execute(call.name, parsed.args, ctx)
        : ({ ok: false, erro: "argumentos inválidos" } as const);
      toolCalls.push({ name: call.name, args: parsed.ok ? parsed.args : null });
      if (result.ok) pushRefs(refs, seen, result.refs);

      const conteudo = JSON.stringify(
        result.ok ? result.data : { erro: result.erro },
      ).slice(0, MAX_TOOL_CHARS);
      await appendMensagem(conversa.id, {
        role: "tool",
        conteudo,
        tool_call_id: call.id,
      });
      messages.push({ role: "tool", tool_call_id: call.id, content: conteudo });
    }
  }

  await appendMensagem(conversa.id, {
    role: "assistant",
    conteudo: DESISTIU,
    refs,
    modelo: model,
  });
  await touchConversa(conversa.id);
  return { conversaId: conversa.id, resposta: DESISTIU, refs, toolCalls };
}
