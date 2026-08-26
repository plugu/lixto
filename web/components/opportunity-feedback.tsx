"use client";

// "Tenho interesse" / "Descartar" on an opportunity card. Optimistic: a
// successful dismiss hides the control (and, per the card's `key`, the whole
// card list shrinks once the parent revalidates) without waiting on a full
// page reload.

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { dismissAction, markInterestAction } from "@/app/(app)/opportunities/actions";

const DISMISS_REASONS = [
  { value: "fora_do_ramo", label: "Fora do ramo" },
  { value: "valor", label: "Valor" },
  { value: "prazo", label: "Prazo" },
  { value: "exigencia", label: "Exigência" },
  { value: "outro", label: "Outro" },
];

type Status = "idle" | "interested" | "dismissed";

export function OpportunityFeedback({ opportunityId }: { opportunityId: number }) {
  const [status, setStatus] = useState<Status>("idle");
  const [showReason, setShowReason] = useState(false);
  const [reason, setReason] = useState(DISMISS_REASONS[0].value);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Optimistic hide: once a dismiss lands, the card disappears from view
  // immediately instead of waiting for `revalidatePath` to refetch the list.
  if (status === "dismissed") return null;

  function handleInterest() {
    setError(null);
    startTransition(async () => {
      const result = await markInterestAction(opportunityId);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setStatus("interested");
    });
  }

  function handleDismiss() {
    setError(null);
    const detail = note.trim();
    startTransition(async () => {
      const result = await dismissAction(
        opportunityId,
        detail ? `${reason}:${detail}` : reason,
      );
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setStatus("dismissed");
    });
  }

  if (status === "interested") {
    return <p className="text-[13px] font-medium text-ok">Interesse registrado.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {error ? <p className="text-[13px] text-danger">{error}</p> : null}

      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={pending}
          onClick={handleInterest}
        >
          Tenho interesse
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => setShowReason((v) => !v)}
        >
          Descartar
        </Button>
      </div>

      {showReason ? (
        <div className="flex flex-col gap-2 rounded-md bg-surface-raised p-2.5">
          <Select
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={pending}
          >
            {DISMISS_REASONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </Select>
          <Input
            placeholder="Detalhe (opcional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={pending}
          />
          <div className="flex justify-end">
            <Button type="button" size="sm" disabled={pending} onClick={handleDismiss}>
              {pending ? "Descartando…" : "Confirmar"}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
