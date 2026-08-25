"use client";

// Textarea + send button, plus the empty-state sample prompts. Enter sends,
// Shift+Enter inserts a newline.

import { useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

const SUGGESTIONS = [
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
  onSend: (text: string) => void;
}) {
  const [text, setText] = useState("");

  function submit() {
    const trimmed = text.trim();
    if (!trimmed || pending) return;
    onSend(trimmed);
    setText("");
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {showSuggestions ? (
        <EmptyState
          title="Pergunte ao Lixto"
          hint="Descreva o que sua empresa procura — o agente busca, cruza com o seu cadastro e explica o porquê de cada resultado."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  disabled={pending}
                  onClick={() => onSend(suggestion)}
                  className="rounded-[9999px] border border-line bg-surface px-3 py-1.5 text-[13px] text-ink hover:bg-surface-raised disabled:opacity-50"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          }
        />
      ) : null}

      <div className="flex items-end gap-2 rounded-[18px] border border-line bg-surface p-2 shadow-card">
        <textarea
          rows={1}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Pergunte ao Lixto…"
          className="max-h-40 min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 text-[15px] leading-6 text-ink outline-none placeholder:text-ink-faint"
        />
        <Button type="button" size="sm" disabled={pending || !text.trim()} onClick={submit}>
          Enviar
        </Button>
      </div>
    </div>
  );
}
