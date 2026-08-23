import type { ReactNode } from "react";

export function Section({
  title,
  eyebrow,
  actions,
  children,
}: {
  title?: string;
  eyebrow?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4">
      {title || eyebrow || actions ? (
        <div className="flex items-center justify-between gap-4">
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
          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}
