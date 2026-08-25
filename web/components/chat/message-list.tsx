"use client";

// Renders the visible turns of a conversation. Only `user` and `assistant`
// rows ever reach this component — `tool` rows are filtered out by chat.tsx
// before they land in state.
//
// "markdown-lite": paragraphs (blank-line separated) and single `\n` line
// breaks are honoured, numbered lines are kept as plain text — no markdown
// library, per the ticket's "Not included".

import { useEffect, useRef } from "react";
import { ProcurementRefCard } from "@/components/chat/procurement-ref-card";
import type { ProcurementRef } from "@/lib/agent/types";

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  refs?: ProcurementRef[];
};

function renderContent(content: string) {
  const paragraphs = content.split(/\n{2,}/);
  return paragraphs.map((paragraph, pIdx) => (
    <p key={pIdx} className={pIdx > 0 ? "mt-2" : undefined}>
      {paragraph.split("\n").map((line, lIdx, lines) => (
        <span key={lIdx}>
          {line}
          {lIdx < lines.length - 1 ? <br /> : null}
        </span>
      ))}
    </p>
  ));
}

export function MessageList({ messages }: { messages: ChatMessage[] }) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  return (
    <div
      aria-live="polite"
      className="flex flex-1 flex-col gap-3 overflow-y-auto pr-1"
    >
      {messages.map((message, idx) => (
        <div
          key={idx}
          className={`flex flex-col gap-2 ${
            message.role === "user" ? "items-end" : "items-start"
          }`}
        >
          <div
            className={`max-w-[85%] rounded-[10px] px-3.5 py-2.5 text-sm leading-6 ${
              message.role === "user"
                ? "bg-accent-soft text-ink"
                : "border border-line bg-surface text-ink"
            }`}
          >
            {renderContent(message.content)}
          </div>

          {message.role === "assistant" && message.refs?.length ? (
            <div className="flex w-full max-w-[85%] flex-col gap-2">
              {message.refs.map((ref, refIdx) => (
                <ProcurementRefCard
                  key={`${ref.source_id}-${refIdx}`}
                  item={ref}
                  index={refIdx + 1}
                />
              ))}
            </div>
          ) : null}
        </div>
      ))}
      <div ref={endRef} />
    </div>
  );
}
