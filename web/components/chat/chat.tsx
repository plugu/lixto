"use client";

// Conversation state + the fetch to POST /api/chat. One request in, one JSON
// reply out — the run.ts runtime has no streaming.

import { useCallback, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Composer } from "@/components/chat/composer";
import { MessageList, type ChatMessage } from "@/components/chat/message-list";
import { QuickFilters, type QuickFilterValues } from "@/components/chat/quick-filters";
import type { Message } from "@/lib/agent/conversation-queries";
import type { ProcurementRef } from "@/lib/agent/types";

type ChatResponse = {
  conversationId: number;
  answer: string;
  refs: ProcurementRef[];
};

type ErrorResponse = { error: string };

const GENERIC_ERROR = "Não consegui responder agora. Tente de novo.";

function toChatMessages(rows: Message[]): ChatMessage[] {
  return rows
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content ?? "",
      refs: m.refs ?? undefined,
    }));
}

export function Chat({
  initialConversationId,
  initialMessages,
  companyName,
  intro,
}: {
  initialConversationId: number | null;
  initialMessages: Message[];
  companyName: string;
  /** Server-rendered slot (e.g. the digest banner + attention cards) shown
   * above the message list only while the conversation is empty. */
  intro?: ReactNode;
}) {
  const [conversationId, setConversationId] = useState<number | null>(
    initialConversationId,
  );
  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    toChatMessages(initialMessages),
  );
  const [filters, setFilters] = useState<QuickFilterValues>({});
  const [pending, setPending] = useState(false);

  const send = useCallback(
    async (text: string) => {
      setMessages((prev) => [...prev, { role: "user", content: text }]);
      setPending(true);

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversationId, text, filters }),
        });

        if (res.status === 401) {
          window.location.href = "/login";
          return;
        }

        // proxy.ts redirects cookieless requests to /login, so an expired
        // session may arrive here as a followed redirect to the HTML login
        // page instead of a 401 — treat any non-JSON body the same way.
        const contentType = res.headers.get("content-type") ?? "";
        if (!contentType.includes("application/json")) {
          window.location.href = "/login";
          return;
        }

        const data = (await res.json()) as ChatResponse | ErrorResponse;
        if (!res.ok || !("answer" in data)) {
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: GENERIC_ERROR },
          ]);
          return;
        }

        setConversationId(data.conversationId);
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: data.answer, refs: data.refs },
        ]);
      } catch {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: GENERIC_ERROR },
        ]);
      } finally {
        setPending(false);
      }
    },
    [conversationId, filters],
  );

  function startNewThread() {
    setConversationId(null);
    setMessages([]);
  }

  return (
    <div className="flex h-[calc(100dvh-8rem)] min-h-[28rem] flex-col gap-3 md:h-[calc(100dvh-9rem)]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-[28px] leading-[34px] text-ink">
            Lixto
          </h1>
          <p className="text-[13px] text-ink-muted">{companyName}</p>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={startNewThread}
        >Nova conversa</Button>
      </div>

      <QuickFilters filters={filters} onChange={setFilters} />

      {intro && messages.length === 0 ? (
        <div className="overflow-y-auto pr-1">{intro}</div>
      ) : null}

      <MessageList messages={messages} />

      <Composer
        pending={pending}
        showSuggestions={messages.length === 0}
        onSend={send}
      />
    </div>
  );
}
