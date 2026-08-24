import type { HTMLAttributes } from "react";

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
