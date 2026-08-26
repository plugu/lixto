"use server";

// Server actions backing the opportunity feedback buttons. Called directly
// from a client component (not through a <form>), so they take plain
// arguments rather than (prevState, formData) — `companyId`/`userId` still
// only ever come from the session, never from the caller.

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { insertFeedback, setOpportunityState } from "@/lib/opportunity-queries";

export type FeedbackActionState = { ok: true } | { error: string };

const DISMISS_REASONS = ["fora_do_ramo", "valor", "prazo", "exigencia", "outro"];

function revalidateDigest() {
  revalidatePath("/opportunities");
  revalidatePath("/lixto");
}

export async function markInterestAction(
  opportunityId: number,
): Promise<FeedbackActionState> {
  const session = await requireSession();

  await insertFeedback(
    session.user.companyId,
    opportunityId,
    session.user.id,
    "accepted",
    null,
  );
  await setOpportunityState(session.user.companyId, opportunityId, "analyzed");

  revalidateDigest();
  return { ok: true };
}

export async function dismissAction(
  opportunityId: number,
  reason: string,
): Promise<FeedbackActionState> {
  const session = await requireSession();

  const [code, ...rest] = reason.split(":");
  if (!DISMISS_REASONS.includes(code)) {
    return { error: "Selecione um motivo." };
  }
  const detail = rest.join(":").trim();

  await insertFeedback(
    session.user.companyId,
    opportunityId,
    session.user.id,
    "rejected",
    detail ? `${code}: ${detail}` : code,
  );
  await setOpportunityState(session.user.companyId, opportunityId, "dismissed");

  revalidateDigest();
  return { ok: true };
}
