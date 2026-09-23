"use client";

// "Ganhou / Perdeu / Desclassificado" (ticket 172): the case's PNCP-derived
// outcome, plus the operator's one-way correction. `markDisqualifiedAction`
// persists it (`setOutcomeByOperator`, lib/case-queries.ts) and mirrors it
// into `opportunity_feedback`; the server action's `revalidatePath` then
// refreshes the page with the case's new outcome props — same idiom as
// case-decision.tsx, no local optimistic state needed.

import { useTransition } from "react";
import { toast } from "sonner";
import { markDisqualifiedAction } from "@/app/(app)/cases/[id]/actions";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { OUTCOME_LABELS } from "@/lib/case-labels";
import type {
  CaseDecision,
  CaseOutcome,
  CaseOutcomeSource,
} from "@/lib/case-queries";
import { formatDateBR } from "@/lib/format";

const OUTCOME_TONES: Record<CaseOutcome, BadgeTone> = {
  won: "ok",
  lost: "warn",
  disqualified: "neutral",
};

const OUTCOME_SOURCE_LABELS: Record<CaseOutcomeSource, string> = {
  pncp: "via PNCP",
  operator: "informado por você",
};

export function CaseOutcome({
  caseId,
  decision,
  outcome,
  outcomeSource,
  outcomeAt,
}: {
  caseId: number;
  decision: CaseDecision | null;
  outcome: CaseOutcome | null;
  outcomeSource: CaseOutcomeSource | null;
  outcomeAt: Date | null;
}) {
  const [pending, startTransition] = useTransition();

  if (decision !== "submit") {
    return (
      <p className="text-sm text-ink-muted">
        Sem acompanhamento de resultado para esta resposta.
      </p>
    );
  }

  function handleDisqualified() {
    startTransition(async () => {
      const result = await markDisqualifiedAction(caseId);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast("Caso marcado como desclassificado");
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {outcome ? (
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={OUTCOME_TONES[outcome]}>{OUTCOME_LABELS[outcome]}</Badge>
          <span className="text-sm text-ink-muted">
            {outcomeSource ? OUTCOME_SOURCE_LABELS[outcomeSource] : null}
            {outcomeAt ? ` · ${formatDateBR(outcomeAt)}` : ""}
          </span>
        </div>
      ) : (
        <p className="text-sm text-ink-muted">
          Aguardando resultado no PNCP (consultado a partir de 2 dias após a
          sessão).
        </p>
      )}

      {outcome !== "disqualified" ? (
        <div>
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={handleDisqualified}
          >
            Fomos desclassificados
          </Button>
        </div>
      ) : null}
    </div>
  );
}
