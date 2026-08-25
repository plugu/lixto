"use client";

// Renders the visible turns of a conversation (ticket 69). Only `user` and
// `assistant` rows ever reach this component — `tool` rows are filtered out
// by chat.tsx before they land in state.
//
// "markdown-lite": paragraphs (blank-line separated) and single `\n` line
// breaks are honoured, numbered lines are kept as plain text — no markdown
// library, per the ticket's "Not included".

import { useEffect, useRef } from "react";
import { LicitacaoRefCard } from "@/components/chat/licitacao-ref-card";
import type { LicitacaoRef } from "@/lib/agent/types";

export type ChatMessage = {
  role: "user" | "assistant";
  conteudo: string;
  refs?: LicitacaoRef[];
};

function renderConteudo(conteudo: string) {
  const paragrafos = conteudo.split(/\n{2,}/);
  return paragrafos.map((paragrafo, pIdx) => (
    <p key={pIdx} className={pIdx > 0 ? "mt-2" : undefined}>
      {paragrafo.split("\n").map((linha, lIdx, linhas) => (
        <span key={lIdx}>
          {linha}
          {lIdx < linhas.length - 1 ? <br /> : null}
        </span>
      ))}
    </p>
  ));
}

export function MessageList({ mensagens }: { mensagens: ChatMessage[] }) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [mensagens.length]);

  return (
    <div
      aria-live="polite"
      className="flex flex-1 flex-col gap-3 overflow-y-auto pr-1"
    >
      {mensagens.map((mensagem, idx) => (
        <div
          key={idx}
          className={`flex flex-col gap-2 ${
            mensagem.role === "user" ? "items-end" : "items-start"
          }`}
        >
          <div
            className={`max-w-[85%] rounded-[10px] px-3.5 py-2.5 text-sm leading-6 ${
              mensagem.role === "user"
                ? "bg-accent-soft text-ink"
                : "border border-line bg-surface text-ink"
            }`}
          >
            {renderConteudo(mensagem.conteudo)}
          </div>

          {mensagem.role === "assistant" && mensagem.refs?.length ? (
            <div className="flex w-full max-w-[85%] flex-col gap-2">
              {mensagem.refs.map((ref, refIdx) => (
                <LicitacaoRefCard
                  key={`${ref.numero_controle_pncp}-${refIdx}`}
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
