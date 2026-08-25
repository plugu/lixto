"use client";

// Conversation state + the fetch to POST /api/chat (ticket 69). One request
// in, one JSON reply out — the run.ts runtime (ticket 68) has no streaming.

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Composer } from "@/components/chat/composer";
import { MessageList, type ChatMessage } from "@/components/chat/message-list";
import { QuickFilters, type QuickFiltros } from "@/components/chat/quick-filters";
import type { Mensagem } from "@/lib/agent/conversa-queries";
import type { LicitacaoRef } from "@/lib/agent/types";

type ChatResponse = {
  conversaId: number;
  resposta: string;
  refs: LicitacaoRef[];
};

type ErroResponse = { erro: string };

const ERRO_GENERICO = "Não consegui responder agora. Tente de novo.";

function toChatMessages(mensagens: Mensagem[]): ChatMessage[] {
  return mensagens
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      role: m.role as "user" | "assistant",
      conteudo: m.conteudo ?? "",
      refs: m.refs ?? undefined,
    }));
}

export function Chat({
  initialConversaId,
  initialMensagens,
  empresaNome,
}: {
  initialConversaId: number | null;
  initialMensagens: Mensagem[];
  empresaNome: string;
}) {
  const [conversaId, setConversaId] = useState<number | null>(initialConversaId);
  const [mensagens, setMensagens] = useState<ChatMessage[]>(() =>
    toChatMessages(initialMensagens),
  );
  const [filtros, setFiltros] = useState<QuickFiltros>({});
  const [pending, setPending] = useState(false);

  const enviar = useCallback(
    async (texto: string) => {
      setMensagens((prev) => [...prev, { role: "user", conteudo: texto }]);
      setPending(true);

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversaId, texto, filtros }),
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

        const data = (await res.json()) as ChatResponse | ErroResponse;
        if (!res.ok || !("resposta" in data)) {
          setMensagens((prev) => [
            ...prev,
            { role: "assistant", conteudo: ERRO_GENERICO },
          ]);
          return;
        }

        setConversaId(data.conversaId);
        setMensagens((prev) => [
          ...prev,
          { role: "assistant", conteudo: data.resposta, refs: data.refs },
        ]);
      } catch {
        setMensagens((prev) => [
          ...prev,
          { role: "assistant", conteudo: ERRO_GENERICO },
        ]);
      } finally {
        setPending(false);
      }
    },
    [conversaId, filtros],
  );

  function novaConversa() {
    setConversaId(null);
    setMensagens([]);
  }

  return (
    <div className="flex h-[calc(100dvh-8rem)] min-h-[28rem] flex-col gap-3 md:h-[calc(100dvh-9rem)]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-[28px] leading-[34px] text-ink">
            Lixto
          </h1>
          <p className="text-[13px] text-ink-muted">{empresaNome}</p>
        </div>
        <Button type="button" variant="secondary" size="sm" onClick={novaConversa}>
          Nova conversa
        </Button>
      </div>

      <QuickFilters filtros={filtros} onChange={setFiltros} />

      <MessageList mensagens={mensagens} />

      <Composer
        pending={pending}
        showSuggestions={mensagens.length === 0}
        onSend={enviar}
      />
    </div>
  );
}
