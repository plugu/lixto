"use client";

import { useEffect, useRef, useState } from "react";
import { Search } from "./icons";

export function CommandSearch() {
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
      } else if (event.key === "Escape") {
        setOpen(false);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-8 w-full items-center gap-2 rounded-md border border-line bg-surface px-2.5 text-[13px] text-ink-faint transition-colors hover:border-accent/40"
      >
        <Search size={14} />
        <span className="flex-1 text-left">Buscar</span>
        <span className="rounded border border-line px-1.5 py-0.5 text-[11px] text-ink-faint">
          ⌘K
        </span>
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-ink/20 pt-[15vh]"
          onClick={() => setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Buscar licitações"
            onClick={(event) => event.stopPropagation()}
            className="w-full max-w-lg rounded-[10px] border border-line bg-surface p-2 shadow-[0_8px_24px_rgba(28,27,24,.10)]"
          >
            <form action="/licitacoes" method="get" className="flex items-center gap-2 px-2 py-1.5">
              <Search size={16} className="shrink-0 text-ink-faint" />
              <input
                ref={inputRef}
                name="q"
                placeholder="Buscar licitações…"
                className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
              />
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
