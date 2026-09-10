"use client";

// "Analisar com IA" on the procurement detail page: enqueues an
// `analysis_jobs` row and polls until it leaves the queued/running state.
// Progress renders as staged steps (ticket 148) — `analysis_jobs.status` is
// only queued|running|done|error, no server-side stages, so the four steps
// below are an elapsed-time estimate, not real progress from the worker. On
// `done` the RSC tree is refreshed inside `startTransition` so the current
// UI stays interactive and scroll position is preserved (ticket 135 renders
// the dossier via `AnalysisPanel`); a toast offers a shortcut to it.

import { startTransition, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Alert, Check } from "@/components/ui/icons";
import { ProgressSteps } from "@/components/ui/progress-steps";
import {
  analysisStatusAction,
  enqueueAnalysisAction,
} from "@/app/(app)/procurement/[sourceId]/actions";

type JobStatus = "queued" | "running" | "done" | "error";
type JobSummary = {
  status: JobStatus;
  error: string | null;
  createdAt: string | null;
};

export type AnalyzeButtonProps = {
  procurementId: number;
  initial: {
    hasAnalysis: boolean;
    stale: boolean;
    job: { status: JobStatus; error: string | null } | null;
  };
};

const POLL_INTERVAL_MS = 5000;
const STEPS = [
  "Na fila",
  "Baixando documentos",
  "Lendo o edital",
  "Montando o dossiê",
];

// `queued` has no elapsed time yet; `running` advances through the
// remaining steps by elapsed time since the job was created — this is an
// estimate, not a real stage from the worker (no migration this cycle).
function stepIndexFor(status: JobStatus, elapsedSeconds: number): number {
  if (status !== "running") return 0;
  if (elapsedSeconds > 45) return 3;
  if (elapsedSeconds > 15) return 2;
  return 1;
}

export function AnalyzeButton({ procurementId, initial }: AnalyzeButtonProps) {
  const router = useRouter();
  const [job, setJob] = useState<JobSummary | null>(
    initial.job ? { ...initial.job, createdAt: null } : null,
  );
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Fallback start instant for the progress timer when the server hasn't
  // told us `created_at` yet — e.g. the page loaded mid-job, before the
  // first poll response arrives. Captured once per mount.
  const [fallbackStartedAt] = useState(() => new Date());
  const [now, setNow] = useState(() => Date.now());

  const isActive = job?.status === "queued" || job?.status === "running";

  // Ticks once a second so the step band (see `stepIndexFor`) advances
  // smoothly; `ProgressSteps` ticks its own clock for the mm:ss display.
  useEffect(() => {
    if (!isActive) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [isActive]);

  useEffect(() => {
    if (!isActive) return;
    let cancelled = false;

    async function poll() {
      const state = await analysisStatusAction(procurementId);
      if (cancelled) return;
      const nextJob = state.job;
      if (!nextJob) {
        // Left the active/recent window (shouldn't normally happen mid-poll,
        // but treat as finished so we don't poll forever).
        setJob(null);
        return;
      }
      setJob({
        status: nextJob.status,
        error: nextJob.error,
        createdAt: nextJob.created_at,
      });
      if (nextJob.status === "done") {
        startTransition(() => router.refresh());
        toast.success("Análise pronta", {
          action: {
            label: "Ver",
            onClick: () =>
              document
                .getElementById("analysis-panel")
                ?.scrollIntoView({ behavior: "smooth", block: "start" }),
          },
        });
      }
    }

    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [isActive, procurementId, router]);

  async function handleClick() {
    setSubmitError(null);
    setPending(true);
    try {
      const result = await enqueueAnalysisAction(procurementId);
      if ("error" in result) {
        setSubmitError(result.error);
        return;
      }
      setJob({
        status: result.job.status,
        error: result.job.error,
        createdAt: result.job.created_at,
      });
    } finally {
      setPending(false);
    }
  }

  if (isActive && job) {
    const startedAt = job.createdAt ?? fallbackStartedAt;
    const elapsedSeconds = Math.max(
      0,
      Math.floor((now - new Date(startedAt).getTime()) / 1000),
    );
    const activeIndex = stepIndexFor(job.status, elapsedSeconds);

    return (
      <div className="flex max-w-xs flex-col gap-1">
        <ProgressSteps
          steps={STEPS}
          activeIndex={activeIndex}
          startedAt={startedAt}
          caption="Tempo estimado: 1–2 min"
        />
      </div>
    );
  }

  const isError = job?.status === "error";
  const label = isError
    ? "Tentar novamente"
    : initial.stale
      ? "Reanalisar — documentos atualizados"
      : "Analisar com IA";

  return (
    <div className="flex flex-col gap-1">
      <Button
        type="button"
        variant="primary"
        disabled={pending}
        onClick={handleClick}
      >
        {label}
      </Button>
      {job?.status === "done" ? (
        <p className="flex items-center gap-1 text-[13px] text-ok">
          <Check size={14} /> Análise concluída.
        </p>
      ) : null}
      {isError ? (
        <p className="flex items-center gap-1 text-[13px] text-danger">
          <Alert size={14} /> Falha na análise: {job.error}
        </p>
      ) : null}
      {submitError ? (
        <p className="text-[13px] text-danger">{submitError}</p>
      ) : null}
    </div>
  );
}
