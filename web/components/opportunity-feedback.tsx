"use client";

// "Tenho interesse" / "Descartar" on an opportunity card (ticket 147). This
// component owns the card's outer wrapper (children come from
// `OpportunityCard`) so a dismiss can animate the *whole* card out and unmount
// it, instead of just hiding the button row: `useOptimistic` flips the local
// status the instant a button is clicked, a `sonner` toast offers "Desfazer"
// for 5s (toaster.tsx), and only after that does the server call land.

import { useOptimistic, useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  dismissAction,
  markInterestAction,
  undoDismissAction,
  undoInterestAction,
} from "@/app/(app)/opportunities/actions";
import type { OpportunityState } from "@/lib/opportunity-queries";

const DISMISS_REASONS = [
  { value: "fora_do_ramo", label: "Fora do ramo" },
  { value: "valor", label: "Valor" },
  { value: "prazo", label: "Prazo" },
  { value: "exigencia", label: "Exigência" },
  { value: "outro", label: "Outro" },
];

/** Matches the CSS transition duration below: `handleDismiss` holds the
 * "leaving" optimistic value on screen this long before committing the real
 * unmount, so the exit animation gets to finish instead of snapping away. */
const LEAVE_MS = 200;

type Status = "idle" | "interested" | "leaving" | "dismissed";

/** Reason pills shown in the dismiss toast's description: picking one calls
 * `dismissAction` again with a real reason. The card already left, and the
 * update is idempotent (same row, same "dismissed" state), so this fires
 * without touching this component's local state. */
function DismissReasonPills({ opportunityId }: { opportunityId: number }) {
  return (
    <div className="flex flex-wrap gap-1.5 pt-1.5">
      {DISMISS_REASONS.map((r) => (
        <Button
          key={r.value}
          type="button"
          variant="pill"
          size="sm"
          className="h-6 px-2 text-[12px]"
          onClick={() => {
            dismissAction(opportunityId, r.value).catch(() => {
              // Best-effort: the card is already gone; a failed reason
              // update just means the row keeps its default "sem_motivo".
            });
          }}
        >
          {r.label}
        </Button>
      ))}
    </div>
  );
}

export function OpportunityFeedback({
  opportunityId,
  previousState,
  children,
}: {
  opportunityId: number;
  previousState: OpportunityState;
  children: ReactNode;
}) {
  const [status, setStatus] = useState<Status>("idle");
  const [optimisticStatus, setOptimisticStatus] = useOptimistic<Status, Status>(
    status,
    (_current, next) => next,
  );
  const [pending, startTransition] = useTransition();

  function handleInterest() {
    startTransition(async () => {
      setOptimisticStatus("interested");
      const result = await markInterestAction(opportunityId);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setStatus("interested");
      toast("Interesse registrado", {
        action: { label: "Desfazer", onClick: handleUndoInterest },
      });
    });
  }

  function handleUndoInterest() {
    startTransition(async () => {
      setOptimisticStatus("idle");
      const result = await undoInterestAction(opportunityId);
      if ("error" in result) {
        setOptimisticStatus("interested");
        toast.error(result.error);
        return;
      }
      setStatus("idle");
    });
  }

  function handleDismiss() {
    startTransition(async () => {
      // Held for the whole transition (through the sleep below), so the
      // optimistic overlay never snaps back to "idle" mid-animation.
      setOptimisticStatus("leaving");
      const result = await dismissAction(opportunityId);
      if ("error" in result) {
        setOptimisticStatus("idle");
        toast.error(result.error);
        return;
      }
      toast("Oportunidade descartada", {
        action: { label: "Desfazer", onClick: handleUndoDismiss },
        description: <DismissReasonPills opportunityId={opportunityId} />,
      });
      await new Promise((resolve) => setTimeout(resolve, LEAVE_MS));
      setStatus("dismissed");
    });
  }

  function handleUndoDismiss() {
    startTransition(async () => {
      setOptimisticStatus("idle");
      const result = await undoDismissAction(opportunityId, previousState);
      if ("error" in result) {
        setOptimisticStatus("dismissed");
        toast.error(result.error);
        return;
      }
      setStatus("idle");
    });
  }

  if (optimisticStatus === "dismissed") return null;
  const leaving = optimisticStatus === "leaving";

  return (
    <div
      data-leaving={leaving ? "" : undefined}
      className={
        "flex flex-col gap-2 rounded-[10px] border border-line bg-surface p-3.5 " +
        "overflow-hidden transition-all duration-200 ease-out motion-reduce:transition-none " +
        (leaving ? "max-h-0 -translate-y-1 opacity-0" : "max-h-[999px] opacity-100")
      }
    >
      {children}

      {optimisticStatus === "interested" ? (
        <p className="text-[13px] font-medium text-ok">Interesse registrado.</p>
      ) : (
        <div className="flex items-center gap-2 pt-1">
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
            onClick={handleDismiss}
          >
            Descartar
          </Button>
        </div>
      )}
    </div>
  );
}
