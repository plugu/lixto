"use server";

// Server actions backing the opportunity feedback buttons. Called directly
// from a client component (not through a <form>), so they take plain
// arguments rather than (prevState, formData) — `companyId`/`userId` still
// only ever come from the session, never from the caller.

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import {
  deleteRecentFeedback,
  insertFeedback,
  restoreOpportunityState,
  setOpportunityState,
  type OpportunityState,
} from "@/lib/opportunity-queries";

export type FeedbackActionState = { ok: true } | { error: string };

const DISMISS_REASONS = ["fora_do_ramo", "valor", "prazo", "exigencia", "outro"];

/** Default reason for the optimistic dismiss (ticket 147): the card exits
 * before the user has to pick anything; the toast's reason pills call
 * `dismissAction` again, idempotently, if they pick a real one afterwards. */
const DEFAULT_DISMISS_REASON = "sem_motivo";

function revalidateDigest() {
  revalidatePath("/opportunities");
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
  reason: string = DEFAULT_DISMISS_REASON,
): Promise<FeedbackActionState> {
  const session = await requireSession();

  const [code, ...rest] = reason.split(":");
  if (code !== DEFAULT_DISMISS_REASON && !DISMISS_REASONS.includes(code)) {
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
  // Idempotent: the card already left on the optimistic click, and the toast's
  // reason pills call this again — regressing a `dismissed` row is harmless,
  // it just rewrites the same state and a fresh `opportunity_feedback` row
  // (which `undoDismissAction`'s 2-minute window still covers).
  await setOpportunityState(session.user.companyId, opportunityId, "dismissed");

  revalidateDigest();
  return { ok: true };
}

/** "Desfazer" on the dismiss toast (ticket 147): puts the opportunity back to
 * whatever it was before (guarded server-side to only fire from `dismissed`)
 * and retracts the `rejected` feedback row the dismiss just wrote. */
export async function undoDismissAction(
  opportunityId: number,
  previousState: OpportunityState,
): Promise<FeedbackActionState> {
  const session = await requireSession();

  await restoreOpportunityState(
    session.user.companyId,
    opportunityId,
    previousState,
  );
  await deleteRecentFeedback(
    session.user.companyId,
    opportunityId,
    session.user.id,
    "rejected",
  );

  revalidateDigest();
  return { ok: true };
}

/** "Desfazer" on the interest toast (ticket 147): only retracts the
 * `accepted` feedback row — marking interest moves the opportunity to
 * `analyzed`, which is a forward, harmless state (ADR 001 §D5: state never
 * regresses), so there is nothing to restore it to. */
export async function undoInterestAction(
  opportunityId: number,
): Promise<FeedbackActionState> {
  const session = await requireSession();

  await deleteRecentFeedback(
    session.user.companyId,
    opportunityId,
    session.user.id,
    "accepted",
  );

  revalidateDigest();
  return { ok: true };
}
