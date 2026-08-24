import type { HTMLAttributes, ReactNode } from "react";

import { Chevron } from "@/components/ui/icons";

function cn(...parts: Array<string | undefined | false>) {
  return parts.filter(Boolean).join(" ");
}

export type CardProps = HTMLAttributes<HTMLDivElement>;

export function Card({ className, children, ...props }: CardProps) {
  return (
    <div
      className={cn("bg-surface rounded-lg shadow-card p-4 sm:p-6", className)}
      {...props}
    >
      {children}
    </div>
  );
}

// Collapsible variant built on native <details>/<summary> so it stays a
// server component — no client JS, keyboard/screen-reader support for free.
// Header typography mirrors the kit Section (eyebrow + display title).
export function CollapsibleCard({
  title,
  eyebrow,
  defaultOpen = true,
  className,
  children,
}: {
  title?: string;
  eyebrow?: string;
  defaultOpen?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <details
      open={defaultOpen}
      className={cn(
        "group bg-surface rounded-lg shadow-card p-4 sm:p-6",
        className,
      )}
    >
      <summary className="flex cursor-pointer select-none list-none items-center justify-between gap-4 [&::-webkit-details-marker]:hidden">
        <div className="flex flex-col gap-1">
          {eyebrow ? (
            <p className="text-xs uppercase tracking-[0.08em] text-ink-faint">
              {eyebrow}
            </p>
          ) : null}
          {title ? (
            <h2 className="font-display text-[17px] leading-6 text-ink">
              {title}
            </h2>
          ) : null}
        </div>
        <span
          aria-hidden="true"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-surface-raised hover:text-ink"
        >
          <Chevron
            size={16}
            className="transition-transform group-open:rotate-90"
          />
        </span>
      </summary>
      <div className="flex flex-col gap-4 pt-4">{children}</div>
    </details>
  );
}
