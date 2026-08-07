"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { FacetOption } from "@/lib/queries";

type MultiSelectProps = {
  /** Checkbox `name` — repeated on submit, carrying every checked value
   * (e.g. `?modalidade=6&modalidade=8`), read server-side by parseFilters. */
  name: string;
  label: string;
  options: FacetOption[];
  selected: string[];
};

const SEARCH_THRESHOLD = 10;

export function MultiSelect({ name, label, options, selected }: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const selectedSet = new Set(selected);
  const hasSelection = selectedSet.size > 0;
  const showSearch = options.length > SEARCH_THRESHOLD;
  const filteredOptions =
    showSearch && search.trim()
      ? options.filter((option) =>
          option.label.toLowerCase().includes(search.trim().toLowerCase()),
        )
      : options;

  function handleApply() {
    setOpen(false);
    containerRef.current?.closest("form")?.requestSubmit();
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        className={`flex items-center gap-1.5 rounded-lg border bg-card px-3 py-1.5 text-sm shadow-subtle transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
          hasSelection
            ? "border-accent text-accent"
            : "border-border text-foreground hover:bg-muted/30"
        }`}
      >
        <span>
          {label}
          {hasSelection ? ` · ${selectedSet.size}` : ""}
        </span>
        <span aria-hidden="true" className="text-xs text-muted-foreground">
          ▾
        </span>
      </button>

      {open && (
        <div className="absolute left-0 top-[calc(100%+4px)] z-20 w-64 rounded-lg border border-border bg-card p-2 shadow-subtle">
          {showSearch && (
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={`Buscar ${label.toLowerCase()}…`}
              className="mb-2 w-full rounded-lg border border-border bg-card px-2 py-1 text-sm text-foreground shadow-subtle focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            />
          )}
          <div className="max-h-64 space-y-0.5 overflow-y-auto">
            {filteredOptions.length === 0 ? (
              <p className="px-2 py-1 text-sm text-muted-foreground">Nenhuma opção.</p>
            ) : (
              filteredOptions.map((option) => {
                const value = String(option.value);
                const checkboxId = `${id}-${value}`;
                return (
                  <label
                    key={value}
                    htmlFor={checkboxId}
                    className="flex cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1 text-sm text-foreground hover:bg-muted/50"
                  >
                    <span className="flex items-center gap-2">
                      <input
                        id={checkboxId}
                        type="checkbox"
                        name={name}
                        value={value}
                        defaultChecked={selectedSet.has(value)}
                        className="h-4 w-4 rounded border-border text-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                      />
                      {option.label}
                    </span>
                    <span className="text-xs text-muted-foreground">{option.count}</span>
                  </label>
                );
              })
            )}
          </div>
          <button
            type="button"
            onClick={handleApply}
            className="mt-2 w-full rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground shadow-sm transition-all duration-150 hover:bg-primary/90 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            Aplicar
          </button>
        </div>
      )}
    </div>
  );
}
