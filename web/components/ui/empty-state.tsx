import type { ReactNode } from "react";

export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon?: ReactNode;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-col items-center justify-center gap-3 rounded-[10px] bg-surface-raised px-6 py-10 text-center">
      {icon ? (
        <span aria-hidden="true" className="text-ink-faint">
          {icon}
        </span>
      ) : null}
      <p className="text-sm font-medium text-ink">{title}</p>
      {hint ? <p className="max-w-sm text-[13px] text-ink-muted">{hint}</p> : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
