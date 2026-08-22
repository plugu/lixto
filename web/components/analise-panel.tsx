// Agent-analysis card for the licitação detail page (ticket 15).
// Renders the triage verdict/score/reasoning, and — when the deep-analysis
// agent has run (deep_status='done') — its requirements table, prazos and
// risks. Hidden entirely when there's no analise row.

import { FitBadge } from "@/components/fit-badge";
import type { AnaliseRow } from "@/lib/analise-queries";

const ATENDE_LABELS: Record<string, string> = {
  sim: "Sim",
  nao: "Não",
  incerto: "Incerto",
};

const DEEP_STATUS_NOTES: Record<string, string> = {
  skipped: "Análise aprofundada não realizada.",
  error: "Falha na análise aprofundada.",
};

export function AnalisePanel({ analise }: { analise: AnaliseRow | null }) {
  if (!analise) return null;

  const verdict = analise.deep_verdict ?? analise.verdict;
  const hasRequirements = (analise.requirements?.length ?? 0) > 0;
  const hasPrazos = (analise.prazos?.length ?? 0) > 0;
  const hasRisks = (analise.risks?.length ?? 0) > 0;

  return (
    <section className="space-y-4 rounded-lg border border-border bg-card p-5 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">
          Análise do agente
        </h2>
        <FitBadge verdict={verdict} score={analise.fit_score} />
      </div>

      {analise.reasoning && (
        <p className="whitespace-pre-wrap text-sm text-foreground">
          {analise.reasoning}
        </p>
      )}

      {(analise.deep_status === "skipped" || analise.deep_status === "error") && (
        <p className="text-xs text-muted-foreground">
          {DEEP_STATUS_NOTES[analise.deep_status]}
          {analise.error ? ` ${analise.error}` : ""}
        </p>
      )}

      {analise.deep_status === "done" && (
        <div className="space-y-4">
          {hasRequirements && (
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                Requisitos
              </h3>
              <div className="overflow-hidden rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                        Tipo
                      </th>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                        Descrição
                      </th>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                        Atende
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {analise.requirements!.map((req, index) => (
                      <tr key={index}>
                        <td className="px-3 py-2 text-foreground">{req.tipo}</td>
                        <td className="px-3 py-2 text-foreground">
                          {req.descricao}
                        </td>
                        <td className="px-3 py-2 text-foreground">
                          {ATENDE_LABELS[req.atende] ?? req.atende}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {hasPrazos && (
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                Prazos
              </h3>
              <ul className="space-y-1 text-sm text-foreground">
                {analise.prazos!.map((prazo, index) => (
                  <li key={index}>
                    <span className="text-muted-foreground">{prazo.evento}:</span>{" "}
                    {prazo.data}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {hasRisks && (
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                Riscos
              </h3>
              <ul className="list-disc space-y-1 pl-5 text-sm text-foreground">
                {analise.risks!.map((risk, index) => (
                  <li key={index}>{risk}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
