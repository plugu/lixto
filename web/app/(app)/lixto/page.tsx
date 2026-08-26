// Conversational-first screen: fetch the most recent conversation + its
// messages server-side, hand them to the client Chat component. No fetch to
// our own /api/chat from here — listConversations/listMessages read straight
// from the DB.
//
// The digest (last match run + attention cards) is fetched here too and
// handed to Chat as `intro` — it only renders while the conversation is
// empty, so it never fights the actual chat history for space.
import type { Metadata } from "next";

import { Chat } from "@/components/chat/chat";
import { DigestBanner } from "@/components/digest-banner";
import { OpportunityCard } from "@/components/opportunity-card";
import {
  listConversations,
  listMessages,
} from "@/lib/agent/conversation-queries";
import { getDigest } from "@/lib/digest-queries";
import { requireSession } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Lixto",
};

export default async function LixtoPage() {
  const session = await requireSession();

  const [conversation] = await listConversations(session.user.id, 1);
  const messages = conversation ? await listMessages(conversation.id) : [];
  const digest = await getDigest(session.user.companyId);

  const companyName = session.company.tradeName ?? session.company.legalName;

  const intro = (
    <div className="flex flex-col gap-3">
      <DigestBanner digest={digest} showLink={digest.attention.length > 0} />
      {digest.attention.map((opportunity) => (
        <OpportunityCard key={opportunity.id} opportunity={opportunity} />
      ))}
    </div>
  );

  return (
    <Chat
      initialConversationId={conversation?.id ?? null}
      initialMessages={messages}
      companyName={companyName}
      intro={intro}
    />
  );
}
