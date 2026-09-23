"use client";

// "Vou enviar / Não vou / Falta documento" (ticket 169): the operator's one
// answer for a case. `decideCaseAction` persists it and mirrors it into
// `opportunity_feedback`; once that succeeds the server action's
// `revalidatePath` refreshes the page with the case's new (decided) props,
// which is what flips this component into its "decided" branch below — no
// local optimistic state needed, unlike opportunity-feedback.tsx's exit
// animation.

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { decideCaseAction } from "@/app/(app)/cases/[id]/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DECISION_LABELS } from "@/lib/case-labels";
import type { CaseDecision, CaseStatus } from "@/lib/case-queries";
import { formatDateBR } from "@/lib/format";

const NOTE_MAX_LENGTH = 200;

export function CaseDecision({
  caseId,
  status,
  decision,
  decisionNote,
  decidedAt,
  decidedByName,
}: {
  caseId: number;
  status: CaseStatus;
  decision: CaseDecision | null;
  decisionNote: string | null;
  decidedAt: Date | null;
  decidedByName: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [showNoteInput, setShowNoteInput] = useState(false);
  const [note, setNote] = useState("");

  function submit(nextDecision: CaseDecision, nextNote: string | null) {
    startTransition(async () => {
      const result = await decideCaseAction(caseId, nextDecision, nextNote);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast("Decisão registrada");
    });
  }

  function handleMissingDocumentConfirm() {
    const trimmed = note.trim();
    if (trimmed.length === 0) return;
    submit("missing_document", trimmed);
  }

  if (status === "waiting_analysis") {
    return (
      <p className="text-sm text-ink-muted">
        Aguardando a análise do edital para montar o caso.
      </p>
    );
  }

  if (status === "decided" && decision) {
    return (
      <p className="text-sm text-ink">
        Você respondeu{" "}
        <strong className="font-medium">{DECISION_LABELS[decision]}</strong>{" "}
        em {formatDateBR(decidedAt)}
        {decidedByName ? ` · ${decidedByName}` : ""}
        {decisionNote ? (
          <span className="mt-1 block text-ink-muted">{decisionNote}</span>
        ) : null}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="primary"
          disabled={pending}
          onClick={() => submit("submit", null)}
        >
          Vou enviar
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={pending}
          onClick={() => submit("skip", null)}
        >
          Não vou
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={pending}
          onClick={() => setShowNoteInput(true)}
        >
          Falta documento
        </Button>
      </div>

      {showNoteInput ? (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            id="decision-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Qual documento?"
            maxLength={NOTE_MAX_LENGTH}
            required
            className="max-w-xs"
          />
          <Button
            type="button"
            variant="primary"
            disabled={pending || note.trim().length === 0}
            onClick={handleMissingDocumentConfirm}
          >
            Confirmar
          </Button>
        </div>
      ) : null}
    </div>
  );
}
