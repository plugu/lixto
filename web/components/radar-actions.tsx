"use client";

// Salvar / Ignorar on a Radar opportunity's detail page (ticket 128; ticket
// 147 adds the optimistic exit + toast). Shape of
// components/opportunity-feedback.tsx: `useOptimistic` flips the button row
// to its target state the instant it's clicked, a `sonner` toast offers
// "Desfazer" for 5s (toaster.tsx) → `clearRadarAction`; a ghost "Desfazer"
// stays next to the settled label so the choice is reversible after the toast.

import { useOptimistic, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  ignoreRadarAction,
  saveRadarAction,
  clearRadarAction,
  type RadarActionState,
} from "@/app/(app)/radar/[id]/actions";
import { Button } from "@/components/ui/button";

type ActionState = "saved" | "ignored" | null;
type Status = ActionState | "leaving";

/** Matches the CSS transition duration below: the button row fades/collapses
 * out before the label swap actually lands. */
const LEAVE_MS = 200;

const STATE_LABELS: Record<"saved" | "ignored", string> = {
  saved: "Salva",
  ignored: "Ignorada",
};

const TOAST_LABELS: Record<"saved" | "ignored", string> = {
  saved: "Oportunidade salva",
  ignored: "Oportunidade ignorada",
};

export function RadarActions({
  id,
  actionState,
}: {
  id: number;
  actionState: ActionState;
}) {
  const [status, setStatus] = useState<Status>(actionState);
  const [optimisticStatus, setOptimisticStatus] = useOptimistic<Status, Status>(
    status,
    (_current, next) => next,
  );
  const [pending, startTransition] = useTransition();

  function apply(
    action: (id: number) => Promise<RadarActionState>,
    next: "saved" | "ignored",
  ) {
    const before = status;
    startTransition(async () => {
      // Held through the sleep below so the row doesn't snap back to the
      // buttons mid-animation.
      setOptimisticStatus("leaving");
      const result = await action(id);
      if ("error" in result) {
        setOptimisticStatus(before);
        toast.error(result.error);
        return;
      }
      toast(TOAST_LABELS[next], {
        action: { label: "Desfazer", onClick: handleUndo },
      });
      await new Promise((resolve) => setTimeout(resolve, LEAVE_MS));
      setStatus(next);
    });
  }

  function handleSave() {
    apply(saveRadarAction, "saved");
  }

  function handleIgnore() {
    apply(ignoreRadarAction, "ignored");
  }

  function handleUndo() {
    const before = status;
    startTransition(async () => {
      setOptimisticStatus("leaving");
      const result = await clearRadarAction(id);
      if ("error" in result) {
        setOptimisticStatus(before);
        toast.error(result.error);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, LEAVE_MS));
      setStatus(null);
    });
  }

  const leaving = optimisticStatus === "leaving";
  const current = leaving ? status : optimisticStatus;
  const settled = current === "saved" || current === "ignored" ? current : null;

  return (
    <div
      data-leaving={leaving ? "" : undefined}
      className={
        "flex items-center gap-2 overflow-hidden transition-all duration-200 ease-out motion-reduce:transition-none " +
        (leaving ? "max-h-0 -translate-y-1 opacity-0" : "max-h-12 opacity-100")
      }
    >
      {settled ? (
        <>
          <span className="text-[13px] font-medium text-ink-muted">
            {STATE_LABELS[settled]}
          </span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={handleUndo}
          >
            Desfazer
          </Button>
        </>
      ) : (
        <>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={pending}
            onClick={handleSave}
          >
            Salvar
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={pending}
            onClick={handleIgnore}
          >
            Ignorar
          </Button>
        </>
      )}
    </div>
  );
}
