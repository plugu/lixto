// Server card for a Radar future opportunity (ticket 127): modelled on
// web/components/opportunity-card.tsx — score badges, reason/signal chips —
// but for a PCA item instead of an already-published procurement.
//
// Label maps moved to web/lib/radar-labels.ts (ticket 128) so the detail
// page's "why" tables can share them.
import Link from "next/link";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { formatCurrencyBRL, formatDateBR } from "@/lib/format";
import type { Reason, ReasonCode } from "@/lib/match-engine";
import { chipLabel } from "@/lib/radar-labels";
import type { RadarListRow } from "@/lib/radar-list-queries";
import type { Signal, SignalCode } from "@/lib/radar-engine";

function scoreTone(score: number): BadgeTone {
  if (score >= 70) return "ok";
  if (score >= 40) return "warn";
  return "neutral";
}

type Chip = { code: SignalCode | ReasonCode; weight: number; detail: string };

function EvidenceChip({ chip }: { chip: Chip }) {
  const label = chipLabel(chip.code);

  if (chip.weight < 0) {
    if (chip.code === "exclusion") {
      return (
        <span
          title={chip.detail}
          className="inline-flex h-6 items-center rounded-[9999px] bg-danger/10 px-2.5 text-[13px] font-medium text-danger"
        >
          {label}
        </span>
      );
    }
    return (
      <span title={chip.detail}>
        <Badge tone="warn">{label}</Badge>
      </span>
    );
  }

  return (
    <span title={chip.detail}>
      <Badge tone="neutral">{label}</Badge>
    </span>
  );
}

const ACTION_LABELS: Record<"saved" | "ignored", string> = {
  saved: "Salva",
  ignored: "Ignorada",
};

function ActionBadge({ actionState }: { actionState: "saved" | "ignored" }) {
  return (
    <Badge tone={actionState === "saved" ? "ok" : "neutral"}>
      {ACTION_LABELS[actionState]}
    </Badge>
  );
}

/** Top 3 pieces of evidence — the opportunity's own signals plus this
 * company's match reasons — ranked by how much weight they carried, so the
 * strongest "why" surfaces first regardless of which list it came from. */
function topEvidence(signals: Signal[], reasons: Reason[]): Chip[] {
  const chips: Chip[] = [
    ...signals.map((s) => ({ code: s.code, weight: s.weight, detail: s.detail })),
    ...reasons.map((r) => ({ code: r.code, weight: r.weight, detail: r.detail })),
  ];
  return [...chips].sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight)).slice(0, 3);
}

export function RadarCard({ opportunity }: { opportunity: RadarListRow }) {
  const location = [opportunity.agency_name, opportunity.unit_name]
    .filter(Boolean)
    .join(" · ");
  const evidence = topEvidence(opportunity.signals ?? [], opportunity.reasons ?? []);

  return (
    <div className="flex flex-col gap-2 rounded-[10px] border border-line bg-surface p-3.5">
      <div className="flex items-start justify-between gap-3">
        <Link
          href={`/radar/${opportunity.id}`}
          className="line-clamp-2 text-sm font-medium text-ink hover:underline"
        >
          {opportunity.title}
        </Link>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Badge tone={scoreTone(opportunity.opportunity_score)}>
            Probabilidade {opportunity.opportunity_score}
          </Badge>
          <Badge tone={scoreTone(opportunity.match_score)}>
            Aderência {opportunity.match_score}
          </Badge>
        </div>
      </div>

      <p className="truncate text-xs text-ink-muted">{location || "—"}</p>

      <div className="flex items-center justify-between text-xs text-ink-muted">
        <span className="tabular-nums text-ink">
          {formatCurrencyBRL(opportunity.estimated_value)}
        </span>
        <span className="tabular-nums">
          {opportunity.expected_date
            ? `Previsto para ${formatDateBR(opportunity.expected_date)}`
            : `Data não informada · PCA ${opportunity.plan_year}`}
        </span>
      </div>

      {evidence.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {evidence.map((chip, idx) => (
            <EvidenceChip key={`${chip.code}-${idx}`} chip={chip} />
          ))}
        </div>
      ) : null}

      {opportunity.action_state ? (
        <div>
          <ActionBadge actionState={opportunity.action_state} />
        </div>
      ) : null}
    </div>
  );
}
