// Conversational-first screen (ticket 69): fetch the most recent conversa +
// its messages server-side, hand them to the client Chat component. No
// fetch to our own /api/chat from here — listConversas/listMensagens read
// straight from the DB (ticket 68).
import type { Metadata } from "next";

import { Chat } from "@/components/chat/chat";
import { listConversas, listMensagens } from "@/lib/agent/conversa-queries";
import { requireSession } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Lixto",
};

export default async function LixtoPage() {
  const session = await requireSession();

  const [conversa] = await listConversas(session.usuario.id, 1);
  const mensagens = conversa ? await listMensagens(conversa.id) : [];

  const empresaNome =
    session.empresa.nomeFantasia ?? session.empresa.razaoSocial;

  return (
    <Chat
      initialConversaId={conversa?.id ?? null}
      initialMensagens={mensagens}
      empresaNome={empresaNome}
    />
  );
}
