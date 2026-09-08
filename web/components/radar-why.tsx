// "Por que estamos mostrando isso?" — the mandatory deterministic breakdown
// on /radar/[id] (ticket 128). Two tables, each listing every signal/reason
// that fed one of the two Radar scores, with its pt-BR label, weight and
// detail, plus a total that must equal the score badge shown in the header.
// No LLM: everything here comes straight off `future_opportunities.signals`
// / `future_opportunity_matches.reasons` (radar-engine.ts).

import type { Reason, ReasonCode } from "@/lib/match-engine";
import { chipLabel } from "@/lib/radar-labels";
import type { Signal, SignalCode } from "@/lib/radar-engine";

type Row = { code: SignalCode | ReasonCode; weight: number; detail: string };

/** Sum of the row weights — must equal the score badge shown in the page
 * header (opportunity_score / match_score), since both are the clamped sum
 * of the very same signals/reasons (radar-engine.ts). Computed here rather
 * than trusting the prop so the table is honest even if a future engine
 * change ever let the two drift. */
function sumWeights(rows: Row[]): number {
  return rows.reduce((acc, row) => acc + row.weight, 0);
}

function WhyTable({ title, rows }: { title: string; rows: Row[] }) {
  const total = sumWeights(rows);
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium text-ink">{title}</h3>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs text-ink-muted">
            <th className="py-1.5 pr-3 font-medium">Motivo</th>
            <th className="py-1.5 pr-3 font-medium">Peso</th>
            <th className="py-1.5 font-medium">Detalhe</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr key={`${row.code}-${idx}`} className="border-b border-line/60">
              <td className="py-1.5 pr-3 text-ink">{chipLabel(row.code)}</td>
              <td
                className={`py-1.5 pr-3 tabular-nums ${row.weight < 0 ? "text-danger" : "text-ink-muted"}`}
              >
                {row.weight > 0 ? `+${row.weight}` : row.weight}
              </td>
              <td className="py-1.5 text-ink-muted">{row.detail}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td className="pt-2 text-xs font-medium uppercase tracking-[0.06em] text-ink-faint">
              Total
            </td>
            <td className="pt-2 tabular-nums text-sm font-medium text-ink">{total}</td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/** Short, hedged intro built purely from the labels of the highest-weight
 * signal and reason — no LLM, no free text generation. */
function buildIntro(signals: Signal[], reasons: Reason[]): string {
  const topSignal = [...signals].sort((a, b) => b.weight - a.weight)[0];
  const topReason = [...reasons].sort((a, b) => b.weight - a.weight)[0];

  const parts: string[] = [];
  if (topSignal) parts.push(chipLabel(topSignal.code).toLowerCase());
  if (topReason) parts.push(chipLabel(topReason.code).toLowerCase());

  if (parts.length === 0) {
    return "Esta oportunidade aparece porque atende aos critérios mínimos do radar.";
  }
  return `Esta oportunidade aparece porque ${parts.join(" e ")}.`;
}

export function RadarWhy({
  signals,
  reasons,
  opportunityScore,
  matchScore,
}: {
  signals: Signal[];
  reasons: Reason[];
  opportunityScore: number;
  matchScore: number;
}) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-ink-muted">{buildIntro(signals, reasons)}</p>
      <div className="grid gap-6 sm:grid-cols-2">
        <WhyTable title={`Probabilidade — ${opportunityScore}`} rows={signals} />
        <WhyTable title={`Aderência — ${matchScore}`} rows={reasons} />
      </div>
    </div>
  );
}
