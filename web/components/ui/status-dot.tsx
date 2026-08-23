export type StatusDotTone = "ok" | "warn" | "off" | "accent" | "neutral";

const TONE_CLASSES: Record<StatusDotTone, string> = {
  ok: "bg-ok",
  warn: "bg-warn",
  off: "bg-off",
  accent: "bg-accent",
  neutral: "bg-ink-faint",
};

export function StatusDot({
  tone = "neutral",
  label,
}: {
  tone?: StatusDotTone;
  label: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] text-ink">
      <span
        aria-hidden="true"
        className={`h-2 w-2 shrink-0 rounded-full ${TONE_CLASSES[tone]}`}
      />
      {label}
    </span>
  );
}
