import type { ReactNode } from "react";

export type BadgeTone = "neutral" | "ok" | "warn" | "off" | "accent";
export type BadgeSize = "sm" | "md";

const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: "bg-surface-raised text-ink-muted",
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  off: "bg-off-soft text-off",
  accent: "bg-accent-soft text-accent",
};

const SIZE_CLASSES: Record<BadgeSize, string> = {
  sm: "h-6 px-2.5",
  md: "h-7 px-3",
};

export function Badge({
  tone = "neutral",
  size = "sm",
  touch = false,
  children,
}: {
  tone?: BadgeTone;
  size?: BadgeSize;
  // Single mechanism for touch targets: reason/evidence chips pass
  // `touch`, which grows the badge to a 44px min height only below `md`
  // (where there's no hover to compensate for a small tap target). Desktop
  // size (`sm`/`md`) is untouched.
  touch?: boolean;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-[9999px] text-[13px] font-medium ${SIZE_CLASSES[size]} ${TONE_CLASSES[tone]} ${
        touch ? "max-md:min-h-11 max-md:px-3" : ""
      }`}
    >
      {children}
    </span>
  );
}
