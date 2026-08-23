"use client";

import type { ReactNode } from "react";
import { useEffect, useRef } from "react";

export type PopoverProps = {
  trigger: ReactNode;
  children: ReactNode;
  align?: "start" | "end";
};

export function Popover({ trigger, children, align = "start" }: PopoverProps) {
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      const el = ref.current;
      if (el && el.open && !el.contains(event.target as Node)) {
        el.open = false;
      }
    }
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, []);

  return (
    <details ref={ref} className="relative">
      <summary className="list-none [&::-webkit-details-marker]:hidden">
        {trigger}
      </summary>
      <div
        className={`absolute top-[calc(100%+6px)] z-20 min-w-48 rounded-[10px] border border-line bg-surface p-2 shadow-[0_8px_24px_rgba(28,27,24,.10)] ${
          align === "end" ? "right-0" : "left-0"
        }`}
      >
        {children}
      </div>
    </details>
  );
}
