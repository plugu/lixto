// POST /api/chat — one turn of the agent conversation.
// GET  /api/chat?conversationId=  — one thread; GET /api/chat — the list.
//
// Everything is scoped to the session's user/company: the body may carry a
// `conversationId`, never a `companyId` (docs/TENANT.md). "@/" aliases are
// fine here — app/ files are compiled by Next, not by the config-less vitest
// run.

import type { NextRequest } from "next/server";

import { getSession } from "@/lib/auth";
import {
  getConversation,
  listConversations,
  listMessages,
} from "@/lib/agent/conversation-queries";
import { ConversationNotFound, runChat, type RunFilters } from "@/lib/agent/run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_TEXT = 2000;

type PostBody = {
  conversationId?: number | null;
  text?: unknown;
  filters?: RunFilters;
};

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "não autenticado" }, { status: 401 });
  }

  let body: PostBody;
  try {
    body = (await request.json()) as PostBody;
  } catch {
    return Response.json({ error: "corpo inválido" }, { status: 400 });
  }

  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text || text.length > MAX_TEXT) {
    return Response.json(
      { error: `texto obrigatório, até ${MAX_TEXT} caracteres` },
      { status: 400 },
    );
  }

  const conversationId =
    typeof body.conversationId === "number" &&
    Number.isFinite(body.conversationId)
      ? body.conversationId
      : null;

  try {
    const out = await runChat(
      { conversationId, text, filters: body.filters },
      session,
    );
    return Response.json({
      conversationId: out.conversationId,
      answer: out.answer,
      refs: out.refs,
    });
  } catch (err) {
    if (err instanceof ConversationNotFound) {
      return Response.json({ error: "conversa não encontrada" }, { status: 404 });
    }
    console.error("[api/chat] agent runtime failed", err);
    return Response.json(
      { error: "falha ao falar com o modelo" },
      { status: 502 },
    );
  }
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "não autenticado" }, { status: 401 });
  }

  const raw = request.nextUrl.searchParams.get("conversationId");
  if (!raw) {
    return Response.json({
      conversations: await listConversations(session.user.id),
    });
  }

  const id = Number(raw);
  const conversation = Number.isFinite(id)
    ? await getConversation(id, session.user.id)
    : null;
  if (!conversation) {
    return Response.json({ error: "conversa não encontrada" }, { status: 404 });
  }
  return Response.json({
    conversation,
    messages: await listMessages(conversation.id),
  });
}
