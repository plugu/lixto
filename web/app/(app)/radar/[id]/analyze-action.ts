"use server";

// Server action backing "Analisar com IA" on /radar/[id] (ticket 129).
// Shape of web/app/(app)/radar/[id]/actions.ts: called directly from a
// client component with a plain `id`; `companyId` always comes from the
// session, never from the caller.

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { analyzeOpportunity } from "@/lib/radar-analysis";
import type { RadarAnalysis } from "@/lib/radar-analysis";

export type AnalyzeRadarActionState =
  | { ok: true; analysis: RadarAnalysis; model: string; created_at: Date | string; cached: boolean }
  | { error: string };

export async function analyzeRadarAction(
  id: number,
): Promise<AnalyzeRadarActionState> {
  if (!Number.isInteger(id)) {
    return { error: "Oportunidade inválida." };
  }
  const session = await requireSession();
  const result = await analyzeOpportunity(session.user.companyId, id);
  if ("error" in result) {
    return { error: result.error };
  }
  revalidatePath(`/radar/${id}`);
  return {
    ok: true,
    analysis: result.analysis,
    model: result.model,
    created_at: result.created_at,
    cached: result.cached,
  };
}
