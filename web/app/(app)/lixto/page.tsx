// Conversational-first screen: fetch the most recent conversation + its
// messages server-side, hand them to the client Chat component. No fetch to
// our own /api/chat from here — listConversations/listMessages read straight
// from the DB.
import type { Metadata } from "next";

import { Chat } from "@/components/chat/chat";
import {
  listConversations,
  listMessages,
} from "@/lib/agent/conversation-queries";
import { requireSession } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Lixto",
};

export default async function LixtoPage() {
  const session = await requireSession();

  const [conversation] = await listConversations(session.user.id, 1);
  const messages = conversation ? await listMessages(conversation.id) : [];

  const companyName = session.company.tradeName ?? session.company.legalName;

  return (
    <Chat
      initialConversationId={conversation?.id ?? null}
      initialMessages={messages}
      companyName={companyName}
    />
  );
}
