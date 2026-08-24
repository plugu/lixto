"use client";

import type { KeyboardEvent, ReactNode } from "react";
import { useRef } from "react";
import { Search } from "./icons";

export type SearchBoxProps = {
  name: string;
  placeholder?: string;
  defaultValue?: string;
  action: string;
  size: "hero" | "inline";
  children?: ReactNode;
};

export function SearchBox({
  name,
  placeholder,
  defaultValue,
  action,
  size,
  children,
}: SearchBoxProps) {
  const formRef = useRef<HTMLFormElement>(null);

  if (size === "inline") {
    return (
      <form
        ref={formRef}
        action={action}
        method="get"
        className="flex h-[34px] items-center gap-2 rounded-md border border-line bg-surface px-3.5 text-[13px] text-ink focus-within:border-accent focus-within:ring-[3px] focus-within:ring-accent-soft"
      >
        <Search size={16} className="shrink-0 text-ink-faint" />
        <input
          name={name}
          defaultValue={defaultValue}
          placeholder={placeholder}
          className="w-full bg-transparent outline-none placeholder:text-ink-faint"
        />
      </form>
    );
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      formRef.current?.requestSubmit();
    }
  }

  return (
    <form
      ref={formRef}
      action={action}
      method="get"
      className="flex flex-col gap-3 rounded-[18px] border border-line bg-surface p-4 shadow-[0_1px_2px_rgba(28,27,24,.06),0_0_0_1px_var(--color-line)]"
    >
      <textarea
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        rows={1}
        onKeyDown={handleKeyDown}
        className="w-full resize-none bg-transparent text-[17px] leading-6 text-ink outline-none placeholder:text-ink-faint"
      />
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">{children}</div>
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="flex h-8 w-8 items-center justify-center rounded-md text-ink-faint"
          >
            <svg
              width={18}
              height={18}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="9" y="2" width="6" height="12" rx="3" />
              <path d="M5 11a7 7 0 0014 0" />
              <path d="M12 18v4" />
            </svg>
          </span>
          <button
            type="submit"
            aria-label="Buscar"
            className="flex h-9 w-9 items-center justify-center rounded-md bg-ink text-surface transition-colors hover:bg-ink/90"
          >
            <svg
              width={16}
              height={16}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 19V5M6 11l6-6 6 6" />
            </svg>
          </button>
        </div>
      </div>
    </form>
  );
}
