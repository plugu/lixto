import type { ReactNode } from "react";

export type BadgeTone = "neutral" | "ok" | "warn" | "off" | "accent";

const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: "bg-surface-raised text-ink-muted",
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  off: "bg-off-soft text-off",
  accent: "bg-accent-soft text-accent",
};

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: BadgeTone;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex h-6 items-center gap-1 rounded-[9999px] px-2.5 text-[13px] font-medium ${TONE_CLASSES[tone]}`}
    >
      {children}
    </span>
  );
}
