"use client";

// Salvar / Ignorar / Desfazer on a Radar opportunity (ticket 128). Shape of
// components/opportunity-feedback.tsx: useTransition, optimistic local
// status so the button reflects the choice without waiting on a full page
// reload (revalidatePath still runs server-side for the list/badge).

import { useState, useTransition } from "react";
import {
  ignoreRadarAction,
  saveRadarAction,
  clearRadarAction,
} from "@/app/(app)/radar/[id]/actions";
import { Button } from "@/components/ui/button";

type ActionState = "saved" | "ignored" | null;

const STATE_LABELS: Record<"saved" | "ignored", string> = {
  saved: "Salva",
  ignored: "Ignorada",
};

export function RadarActions({
  id,
  actionState,
}: {
  id: number;
  actionState: ActionState;
}) {
  const [status, setStatus] = useState<ActionState>(actionState);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSave() {
    setError(null);
    startTransition(async () => {
      const result = await saveRadarAction(id);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setStatus("saved");
    });
  }

  function handleIgnore() {
    setError(null);
    startTransition(async () => {
      const result = await ignoreRadarAction(id);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setStatus("ignored");
    });
  }

  function handleUndo() {
    setError(null);
    startTransition(async () => {
      const result = await clearRadarAction(id);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setStatus(null);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      {error ? <p className="text-[13px] text-danger">{error}</p> : null}

      <div className="flex items-center gap-2">
        {status ? (
          <>
            <span className="text-[13px] font-medium text-ink-muted">
              {STATE_LABELS[status]}
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
    </div>
  );
}
