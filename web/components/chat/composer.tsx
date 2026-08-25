"use client";

// Textarea + send button, plus the empty-state sample prompts (ticket 69).
// Enter sends, Shift+Enter inserts a newline.

import { useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

const SUGESTOES = [
  "Liste licitações abertas com lápis como item",
  "Quais licitações combinam com minha empresa?",
  "Só no Rio de Janeiro, acima de R$ 100 mil",
  "Analise a segunda",
];

export function Composer({
  pending,
  showSuggestions,
  onSend,
}: {
  pending: boolean;
  showSuggestions: boolean;
  onSend: (texto: string) => void;
}) {
  const [texto, setTexto] = useState("");

  function submeter() {
    const trimmed = texto.trim();
    if (!trimmed || pending) return;
    onSend(trimmed);
    setTexto("");
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submeter();
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {showSuggestions ? (
        <EmptyState
          title="Pergunte ao Lixto"
          hint="Descreva o que sua empresa procura — o agente busca, cruza com o perfil e explica o porquê de cada resultado."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              {SUGESTOES.map((sugestao) => (
                <button
                  key={sugestao}
                  type="button"
                  disabled={pending}
                  onClick={() => onSend(sugestao)}
                  className="rounded-[9999px] border border-line bg-surface px-3 py-1.5 text-[13px] text-ink hover:bg-surface-raised disabled:opacity-50"
                >
                  {sugestao}
                </button>
              ))}
            </div>
          }
        />
      ) : null}

      <div className="flex items-end gap-2 rounded-[18px] border border-line bg-surface p-2 shadow-card">
        <textarea
          rows={1}
          value={texto}
          onChange={(event) => setTexto(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Pergunte ao Lixto…"
          className="max-h-40 min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 text-[15px] leading-6 text-ink outline-none placeholder:text-ink-faint"
        />
        <Button
          type="button"
          size="sm"
          disabled={pending || !texto.trim()}
          onClick={submeter}
        >
          Enviar
        </Button>
      </div>
    </div>
  );
}
