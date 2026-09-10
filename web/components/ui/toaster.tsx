"use client";

import { Toaster as SonnerToaster } from "sonner";

export function Toaster() {
  return (
    <SonnerToaster
      position="bottom-right"
      closeButton
      toastOptions={{
        duration: 5000,
        classNames: {
          toast: "bg-surface border-line text-ink rounded-[10px] shadow-[0_8px_24px_rgba(24,24,27,.1)] border",
          title: "text-ink",
          description: "text-ink-muted",
          actionButton: "bg-accent text-surface",
          cancelButton: "bg-surface-raised text-ink",
        },
      }}
    />
  );
}
