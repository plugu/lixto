// Server card for a Radar future opportunity (ticket 127): modelled on
// web/components/opportunity-card.tsx — score badges, reason/signal chips —
// but for a PCA item instead of an already-published procurement.
//
// Label maps moved to web/lib/radar-labels.ts (ticket 128) so the detail
// page's "why" tables can share them.
//
// This card is read-only (list view): Salvar/Ignorar/Desfazer only exist on
// /radar/[id] (components/radar-actions.tsx), which owns the optimistic exit
// animation + "Desfazer" toast added in ticket 147. There is nothing to
// animate here — `action_state` just reflects whatever that page last set.
import Link from "next/link";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Popover } from "@/components/ui/popover";
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

  const badge =
    chip.weight < 0 && chip.code === "exclusion" ? (
      <span className="inline-flex h-6 items-center rounded-[9999px] bg-danger/10 px-2.5 text-[13px] font-medium text-danger max-md:min-h-11 max-md:px-3">
        {label}
      </span>
    ) : (
      <Badge tone={chip.weight < 0 ? "warn" : "neutral"} touch>
        {label}
      </Badge>
    );

  // Chips without a detail render plain — no popover, nothing to tap for.
  if (!chip.detail) return badge;

  return (
    <Popover hover trigger={badge}>
      <p className="max-w-xs text-[13px] text-ink-muted p-2">{chip.detail}</p>
    </Popover>
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
          className="line-clamp-2 rounded-sm text-sm font-medium text-ink hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent-soft"
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
