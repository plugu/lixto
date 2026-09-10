"use client";

// Client pill-tab group backed by `nuqs` (ticket 143). Replaces the
// `<Link>` pill rows in breakdown-section.tsx, opportunities/page.tsx and
// radar/page.tsx with a single component: clicking a pill updates the URL
// param client-side (`shallow: false`, so the server page still re-renders
// with the new `searchParams` and streams through its Suspense/loading
// boundary), pushes a history entry, and drops the param entirely when the
// value equals the default (`clearOnDefault`) so the default URL stays
// canonical (e.g. `/opportunities`, no `?view=`).
import { parseAsStringLiteral, useQueryState } from "nuqs";
import { useTransition } from "react";
import type { KeyboardEvent } from "react";

export type PillTabsProps<Value extends string> = {
  param: string;
  options: { value: Value; label: string }[];
  defaultValue: Value;
  ariaLabel: string;
};

export function PillTabs<Value extends string>({
  param,
  options,
  defaultValue,
  ariaLabel,
}: PillTabsProps<Value>) {
  const values = options.map((o) => o.value) as [Value, ...Value[]];
  const [value, setValue] = useQueryState(
    param,
    parseAsStringLiteral(values).withDefault(defaultValue).withOptions({
      shallow: false,
      history: "push",
      clearOnDefault: true,
    }),
  );
  const [isPending, startTransition] = useTransition();

  function select(next: Value) {
    const run = () => startTransition(() => {
      void setValue(next);
    });
    if (typeof document !== "undefined" && "startViewTransition" in document) {
      document.startViewTransition?.(run);
    } else {
      run();
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number | null = null;
    if (event.key === "ArrowLeft") {
      nextIndex = (index - 1 + options.length) % options.length;
    } else if (event.key === "ArrowRight") {
      nextIndex = (index + 1) % options.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = options.length - 1;
    }
    if (nextIndex === null) return;
    event.preventDefault();
    const next = options[nextIndex];
    if (!next) return;
    select(next.value);
    const tabs = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
      '[role="tab"]',
    );
    tabs?.[nextIndex]?.focus();
  }

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      aria-busy={isPending}
      className="flex items-center gap-1"
    >
      {options.map((option, index) => {
        const isSelected = option.value === value;
        const isTarget = isPending && option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={isSelected}
            tabIndex={isSelected ? 0 : -1}
            onClick={() => select(option.value)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={`rounded-[9999px] px-3 py-1 text-[13px] font-medium transition-colors ${
              isSelected
                ? "bg-ink text-surface"
                : "bg-surface-raised text-ink-muted hover:bg-line/60 hover:text-ink"
            } ${isTarget ? "opacity-60" : ""}`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
