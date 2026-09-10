"use client";

// Reusable staged progress indicator for long-running async actions
// (procurement analysis, radar analysis). `analysis_jobs.status` is only
// queued|running|done|error — no server-side stages this cycle — so callers
// derive `activeIndex` from status + elapsed time and pass it in here.
// `useElapsedSeconds` ticks a shared 1s clock so the mm:ss display below and
// the elapsed-based step bands at each call site stay in sync without
// duplicating timer logic in every consumer.

import { useEffect, useState } from "react";
import { Check } from "@/components/ui/icons";

export function useElapsedSeconds(startedAt: Date | string): number {
  const startMs =
    typeof startedAt === "string" ? new Date(startedAt).getTime() : startedAt.getTime();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  return Math.max(0, Math.floor((now - startMs) / 1000));
}

function formatElapsed(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export type ProgressStepsProps = {
  steps: string[];
  activeIndex: number;
  startedAt: Date | string;
  caption?: string;
};

export function ProgressSteps({
  steps,
  activeIndex,
  startedAt,
  caption,
}: ProgressStepsProps) {
  const elapsed = useElapsedSeconds(startedAt);

  return (
    <div className="flex flex-col gap-2">
      <ol className="flex flex-col gap-1.5">
        {steps.map((step, index) => {
          if (index < activeIndex) {
            return (
              <li
                key={step}
                className="flex items-center gap-2 text-[13px] text-ink-muted"
              >
                <Check size={14} className="shrink-0" />
                <span>{step}</span>
              </li>
            );
          }

          if (index === activeIndex) {
            return (
              <li
                key={step}
                className="flex items-center gap-2 text-[13px] text-ink"
              >
                <span
                  className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none"
                  aria-hidden
                />
                <span>{step}</span>
                <span className="text-ink-muted">{formatElapsed(elapsed)}</span>
              </li>
            );
          }

          return (
            <li
              key={step}
              className="flex items-center gap-2 text-[13px] text-ink-faint"
            >
              <span
                className="h-3.5 w-3.5 shrink-0 rounded-full border border-current"
                aria-hidden
              />
              <span>{step}</span>
            </li>
          );
        })}
      </ol>
      {caption ? <p className="text-[13px] text-ink-faint">{caption}</p> : null}
    </div>
  );
}
