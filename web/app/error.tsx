"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Alert } from "@/components/ui/icons";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <EmptyState
      icon={<Alert size={20} />}
      title="Algo deu errado"
      hint="Ocorreu um erro inesperado ao carregar esta página."
      action={
        <Button type="button" variant="primary" size="sm" onClick={() => reset()}>
          Tentar novamente
        </Button>
      }
    />
  );
}
