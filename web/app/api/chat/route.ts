// POST /api/chat — one turn of the agent conversation (ticket 68).
// GET  /api/chat?conversaId=  — one thread; GET /api/chat — the thread list.
//
// Everything is scoped to the session's usuario/empresa: the body may carry a
// `conversaId`, never an `empresaId` (docs/TENANT.md). "@/" aliases are fine
// here — app/ files are compiled by Next, not by the config-less vitest run.

import type { NextRequest } from "next/server";

import { getSession } from "@/lib/auth";
import {
  getConversa,
  listConversas,
  listMensagens,
} from "@/lib/agent/conversa-queries";
import { ConversaNotFound, runChat, type RunFiltros } from "@/lib/agent/run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_TEXTO = 2000;

type PostBody = {
  conversaId?: number | null;
  texto?: unknown;
  filtros?: RunFiltros;
};

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return Response.json({ erro: "não autenticado" }, { status: 401 });
  }

  let body: PostBody;
  try {
    body = (await request.json()) as PostBody;
  } catch {
    return Response.json({ erro: "corpo inválido" }, { status: 400 });
  }

  const texto = typeof body.texto === "string" ? body.texto.trim() : "";
  if (!texto || texto.length > MAX_TEXTO) {
    return Response.json(
      { erro: `texto obrigatório, até ${MAX_TEXTO} caracteres` },
      { status: 400 },
    );
  }

  const conversaId =
    typeof body.conversaId === "number" && Number.isFinite(body.conversaId)
      ? body.conversaId
      : null;

  try {
    const out = await runChat(
      { conversaId, texto, filtros: body.filtros },
      session,
    );
    return Response.json({
      conversaId: out.conversaId,
      resposta: out.resposta,
      refs: out.refs,
    });
  } catch (error) {
    if (error instanceof ConversaNotFound) {
      return Response.json({ erro: "conversa não encontrada" }, { status: 404 });
    }
    console.error("[api/chat] falha no runtime do agente", error);
    return Response.json(
      { erro: "falha ao falar com o modelo" },
      { status: 502 },
    );
  }
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return Response.json({ erro: "não autenticado" }, { status: 401 });
  }

  const raw = request.nextUrl.searchParams.get("conversaId");
  if (!raw) {
    return Response.json({
      conversas: await listConversas(session.usuario.id),
    });
  }

  const id = Number(raw);
  const conversa = Number.isFinite(id)
    ? await getConversa(id, session.usuario.id)
    : null;
  if (!conversa) {
    return Response.json({ erro: "conversa não encontrada" }, { status: 404 });
  }
  return Response.json({
    conversa,
    mensagens: await listMensagens(conversa.id),
  });
}
