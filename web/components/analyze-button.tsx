"use client";

// "Analisar com IA" on the procurement detail page: enqueues an
// `analysis_jobs` row and polls until it leaves the queued/running state,
// then refreshes the page so the server component picks up the new dossier
// (ticket 135 renders it via `AnalysisPanel`).

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Alert, Check } from "@/components/ui/icons";
import {
  analysisStatusAction,
  enqueueAnalysisAction,
} from "@/app/(app)/procurement/[sourceId]/actions";

type JobStatus = "queued" | "running" | "done" | "error";
type JobSummary = { status: JobStatus; error: string | null };

export type AnalyzeButtonProps = {
  procurementId: number;
  initial: {
    hasAnalysis: boolean;
    stale: boolean;
    job: JobSummary | null;
  };
};

const POLL_INTERVAL_MS = 5000;

export function AnalyzeButton({ procurementId, initial }: AnalyzeButtonProps) {
  const router = useRouter();
  const [job, setJob] = useState<JobSummary | null>(initial.job);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const isActive = job?.status === "queued" || job?.status === "running";

  useEffect(() => {
    if (!isActive) return;

    const interval = setInterval(async () => {
      const state = await analysisStatusAction(procurementId);
      const nextJob = state.job;
      if (!nextJob) {
        // Left the active/recent window (shouldn't normally happen mid-poll,
        // but treat as finished so we don't poll forever).
        setJob(null);
        return;
      }
      setJob({ status: nextJob.status, error: nextJob.error });
      if (nextJob.status === "done") {
        router.refresh();
      }
    }, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
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
      setJob({ status: result.job.status, error: result.job.error });
    } finally {
      setPending(false);
    }
  }

  if (isActive) {
    return (
      <div className="flex flex-col gap-1">
        <Button type="button" variant="primary" disabled>
          <Spinner />
          Analisando… (1–5 min)
        </Button>
      </div>
    );
  }

  const label = initial.stale
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
      {job?.status === "error" ? (
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

function Spinner() {
  return (
    <span
      className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
      aria-hidden
    />
  );
}
