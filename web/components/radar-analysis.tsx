"use client";

// "Analisar com IA" on /radar/[id] (ticket 129). Shape of radar-actions.tsx:
// useTransition. There is no "undo" here — see PRODUCT §Not included: no
// regenerate button, delete the row manually if needed.

import { useState, useTransition } from "react";
import { analyzeRadarAction } from "@/app/(app)/radar/[id]/analyze-action";
import { Button } from "@/components/ui/button";
import { formatDateBR } from "@/lib/format";
import type { RadarAnalysis as RadarAnalysisContent } from "@/lib/radar-analysis";

export type RadarAnalysisInitial = {
  analysis: RadarAnalysisContent;
  model: string;
  created_at: Date | string;
};

export function RadarAnalysis({
  id,
  initial,
}: {
  id: number;
  initial: RadarAnalysisInitial | null;
}) {
  const [result, setResult] = useState<RadarAnalysisInitial | null>(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleAnalyze() {
    setError(null);
    startTransition(async () => {
      const response = await analyzeRadarAction(id);
      if ("error" in response) {
        setError(response.error);
        return;
      }
      setResult({
        analysis: response.analysis,
        model: response.model,
        created_at: response.created_at,
      });
    });
  }

  if (!result) {
    return (
      <div className="flex flex-col gap-2">
        {error ? <p className="text-[13px] text-danger">{error}</p> : null}
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={pending}
          onClick={handleAnalyze}
        >
          {pending ? "Analisando…" : "Analisar com IA"}
        </Button>
        <p className="text-[13px] text-ink-muted">
          Gera uma análise a partir dos sinais mostrados acima; nenhuma
          previsão é uma confirmação.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-1">
        <h3 className="text-sm font-medium text-ink">Por que pode acontecer</h3>
        <p className="text-sm text-ink-muted">
          {result.analysis.why_it_may_happen}
        </p>
      </section>

      <section className="flex flex-col gap-1">
        <h3 className="text-sm font-medium text-ink">
          Compatibilidade com a empresa
        </h3>
        <p className="text-sm text-ink-muted">{result.analysis.company_fit}</p>
      </section>

      <section className="flex flex-col gap-1">
        <h3 className="text-sm font-medium text-ink">Como se preparar</h3>
        {result.analysis.preparation.length > 0 ? (
          <ol className="list-decimal space-y-1 pl-5 text-sm text-ink-muted">
            {result.analysis.preparation.map((step, idx) => (
              <li key={idx}>{step}</li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-ink-muted">—</p>
        )}
      </section>

      <footer className="text-xs text-ink-faint">
        Gerado por {result.model} em {formatDateBR(result.created_at, true)}
      </footer>

      {error ? <p className="text-[13px] text-danger">{error}</p> : null}
    </div>
  );
}
