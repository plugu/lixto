// Agent-analysis panel for the licitação detail page (ticket 34, cycle 8
// restyle). Renders the triage verdict/score/reasoning, and — when the
// deep-analysis agent has run (deep_status='done') — its requirements table,
// prazos and risks. Hidden entirely when there's no analise row. Rendered as
// an accented card (top border) so it reads distinct from the plain white
// cards in the sidebar (ticket 49).

import { FitBadge } from "@/components/fit-badge";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/icons";
import { Section } from "@/components/ui/section";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
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
    <Card className="border-t-2 border-t-accent">
      <Section eyebrow="Análise">
        <div className="flex items-center gap-2">
          <FitBadge verdict={verdict} score={analise.fit_score} />
        </div>

        {analise.reasoning && (
          <p className="whitespace-pre-wrap text-sm text-ink">
            {analise.reasoning}
          </p>
        )}

        {(analise.deep_status === "skipped" ||
          analise.deep_status === "error") && (
          <p className="text-xs text-ink-muted">
            {DEEP_STATUS_NOTES[analise.deep_status]}
            {analise.error ? ` ${analise.error}` : ""}
          </p>
        )}

        {analise.deep_status === "done" && (
          <div className="flex min-w-0 flex-col gap-5">
            {hasRequirements && (
              <div className="flex min-w-0 flex-col gap-2">
                <h3 className="text-xs font-medium uppercase tracking-[0.08em] text-ink-faint">
                  Requisitos
                </h3>
                <div className="min-w-0 -mx-4 overflow-x-auto px-4 sm:-mx-6 sm:px-6">
                  <Table density="compact">
                    <THead bg="surface">
                      <TH>Tipo</TH>
                      <TH>Descrição</TH>
                      <TH>Atende</TH>
                    </THead>
                    <TBody>
                      {analise.requirements!.map((req, index) => (
                        <TR key={index}>
                          <TD>{req.tipo}</TD>
                          <TD>{req.descricao}</TD>
                          <TD>{ATENDE_LABELS[req.atende] ?? req.atende}</TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </div>
              </div>
            )}

            {hasPrazos && (
              <div className="flex flex-col gap-2">
                <h3 className="text-xs font-medium uppercase tracking-[0.08em] text-ink-faint">
                  Prazos
                </h3>
                <ul className="flex flex-col gap-1 text-sm text-ink">
                  {analise.prazos!.map((prazo, index) => (
                    <li key={index}>
                      <span className="text-ink-muted">{prazo.evento}:</span>{" "}
                      {prazo.data}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {hasRisks && (
              <div className="flex flex-col gap-2">
                <h3 className="text-xs font-medium uppercase tracking-[0.08em] text-ink-faint">
                  Riscos
                </h3>
                <ul className="flex flex-col gap-1.5 text-sm text-ink">
                  {analise.risks!.map((risk, index) => (
                    <li key={index} className="flex items-start gap-2">
                      <Alert size={16} className="mt-0.5 shrink-0 text-warn" />
                      <span>{risk}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Section>
    </Card>
  );
}
