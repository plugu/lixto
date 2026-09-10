"use client";

import type { ReactNode } from "react";
import { useEffect, useRef } from "react";

export type PopoverProps = {
  trigger: ReactNode;
  children: ReactNode;
  align?: "start" | "end";
  // On pointer-fine devices (mouse/trackpad), also open on hover/focus after
  // a 150ms delay, closing immediately on mouseleave/focusout — so desktop
  // users see the detail without a click, while touch devices keep the
  // native `details` tap-to-open/close behaviour untouched.
  hover?: boolean;
};

export function Popover({
  trigger,
  children,
  align = "start",
  hover = false,
}: PopoverProps) {
  const ref = useRef<HTMLDetailsElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  useEffect(() => {
    if (!hover) return;
    const el = ref.current;
    if (!el || !window.matchMedia("(pointer: fine)").matches) return;

    const clearTimer = () => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
    };

    const handleEnter = () => {
      clearTimer();
      timer.current = setTimeout(() => {
        el.open = true;
      }, 150);
    };

    const handleLeave = () => {
      clearTimer();
      el.open = false;
    };

    el.addEventListener("mouseenter", handleEnter);
    el.addEventListener("mouseleave", handleLeave);
    el.addEventListener("focusin", handleEnter);
    el.addEventListener("focusout", handleLeave);
    return () => {
      clearTimer();
      el.removeEventListener("mouseenter", handleEnter);
      el.removeEventListener("mouseleave", handleLeave);
      el.removeEventListener("focusin", handleEnter);
      el.removeEventListener("focusout", handleLeave);
    };
  }, [hover]);

  return (
    <details ref={ref} className="relative">
      <summary className="list-none rounded-md [&::-webkit-details-marker]:hidden focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent-soft">
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
