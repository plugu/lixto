import type { ButtonHTMLAttributes, ReactNode } from "react";

function cn(...parts: Array<string | undefined | false>) {
  return parts.filter(Boolean).join(" ");
}

export function Toolbar({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex items-center gap-2", className)}>{children}</div>
  );
}

export function ToolbarButton({
  icon,
  label,
  count,
  className,
  ...props
}: {
  icon: ReactNode;
  label: string;
  count?: number;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex h-9 items-center gap-1.5 rounded-[9999px] bg-surface-raised px-3 text-[13px] font-medium text-ink transition-colors hover:bg-line/60",
        className,
      )}
      {...props}
    >
      <span aria-hidden="true" className="text-ink-muted">
        {icon}
      </span>
      {label}
      {typeof count === "number" ? (
        <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-[9999px] bg-accent-soft px-1 text-[11px] font-semibold text-accent">
          {count}
        </span>
      ) : null}
    </button>
  );
}
