"use server";

// Server actions backing the "Analisar com IA" button on the procurement
// detail page. Called directly from a client component (not through a
// <form>), so they take plain arguments — `companyId`/`userId` still only
// ever come from the session, never from the caller.

import { requireSession } from "@/lib/auth";
import {
  enqueueAnalysis,
  getAnalysisState,
  type AnalysisJob,
} from "@/lib/analysis-queries";

export type EnqueueAnalysisState =
  | { ok: true; job: SerializedJob }
  | { error: string };

export type SerializedJob = {
  id: number;
  status: AnalysisJob["status"];
  error: string | null;
  created_at: string;
};

export type SerializedAnalysisState = {
  analysis: {
    version: number;
    status: "done" | "error";
    error: string | null;
    document_set_hash: string | null;
    analyzed_at: string;
  } | null;
  stale: boolean;
  job: SerializedJob | null;
};

function serializeJob(job: AnalysisJob): SerializedJob {
  return {
    id: job.id,
    status: job.status,
    error: job.error,
    created_at: job.created_at.toISOString(),
  };
}

export async function enqueueAnalysisAction(
  procurementId: number,
): Promise<EnqueueAnalysisState> {
  const session = await requireSession();

  const result = await enqueueAnalysis(
    procurementId,
    session.user.companyId,
    session.user.id,
  );
  if ("error" in result) return result;
  return { ok: true, job: serializeJob(result.job) };
}

export async function analysisStatusAction(
  procurementId: number,
): Promise<SerializedAnalysisState> {
  const session = await requireSession();

  const state = await getAnalysisState(procurementId, session.user.companyId);
  return {
    analysis: state.analysis
      ? {
          version: state.analysis.version,
          status: state.analysis.status,
          error: state.analysis.error,
          document_set_hash: state.analysis.document_set_hash,
          analyzed_at: state.analysis.analyzed_at.toISOString(),
        }
      : null,
    stale: state.stale,
    job: state.job ? serializeJob(state.job) : null,
  };
}
