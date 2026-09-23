"use server";

// Server action for the case agent's one question (ticket 169): the
// operator's answer is stored on the case (`decideCase`, ticket 168) and
// mirrored into `opportunity_feedback` — the same table the proactive
// loop's "Tenho interesse"/"Descartar" already write to
// (lib/opportunity-queries.ts) — so a case's answer feeds the same
// learning-loop history as any other opportunity signal. "Falta documento"
// writes no feedback: it isn't a go/no-go signal, just a note for a human.

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import {
  decideCase,
  setOutcomeByOperator,
  type CaseDecision,
} from "@/lib/case-queries";
import {
  insertFeedback,
  setOpportunityState,
} from "@/lib/opportunity-queries";

const VALID_DECISIONS: CaseDecision[] = ["submit", "skip", "missing_document"];

function isCaseDecision(value: string): value is CaseDecision {
  return (VALID_DECISIONS as string[]).includes(value);
}

export async function decideCaseAction(
  caseId: number,
  decision: string,
  note: string | null,
): Promise<{ ok: true } | { error: string }> {
  const session = await requireSession();

  if (!isCaseDecision(decision)) {
    return { error: "Escolha uma resposta." };
  }

  // Only "missing_document" carries a note — the other two decisions always
  // persist null, whatever the caller passed.
  let storedNote: string | null = null;
  if (decision === "missing_document") {
    storedNote = (note ?? "").trim();
    if (storedNote.length === 0 || storedNote.length > 200) {
      return { error: "Diga qual documento falta." };
    }
  }

  const result = await decideCase(
    session.user.companyId,
    caseId,
    session.user.id,
    decision,
    storedNote,
  );
  if (!result) {
    return { error: "Caso não encontrado ou já decidido." };
  }

  if (decision === "skip") {
    await insertFeedback(
      session.user.companyId,
      result.opportunity_id,
      session.user.id,
      "rejected",
      "caso:nao_vou",
    );
    await setOpportunityState(
      session.user.companyId,
      result.opportunity_id,
      "dismissed",
    );
  } else if (decision === "submit") {
    await insertFeedback(
      session.user.companyId,
      result.opportunity_id,
      session.user.id,
      "participated",
      "caso:vou_enviar",
    );
  }

  revalidatePath("/cases");
  revalidatePath(`/cases/${caseId}`);

  return { ok: true };
}


// "Fomos desclassificados" (ticket 172): the operator's correction, any time
// after "Vou enviar". `setOutcomeByOperator` is a one-way write only in the
// sense that it always requires `decision = 'submit'` — it carries no
// `outcome IS NULL` guard, so a PNCP-derived `won`/`lost` can still be
// corrected here.
export async function markDisqualifiedAction(
  caseId: number,
): Promise<{ ok: true } | { error: string }> {
  const session = await requireSession();

  const result = await setOutcomeByOperator(session.user.companyId, caseId);
  if (!result) {
    return { error: "Caso não encontrado ou sem resposta 'Vou enviar'." };
  }

  await insertFeedback(
    session.user.companyId,
    result.opportunity_id,
    session.user.id,
    "disqualified",
    "caso:operador",
  );

  revalidatePath("/cases");
  revalidatePath(`/cases/${caseId}`);

  return { ok: true };
}
