// Compact card for a `ProcurementRef` cited by the agent. Same visual
// language as `components/procurement-card.tsx`, plus the match score
// ("Aderência") and up to 4 reason chips when the ref came from a match tool.
import Link from "next/link";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { StatusBadge } from "@/components/status-badge";
import { formatCurrencyBRL, formatDateBR } from "@/lib/format";
import type { ProcurementRef } from "@/lib/agent/types";
import type { Reason, ReasonCode } from "@/lib/match-engine";

// The match engine clamps the score to 0..100 but never actually reaches it
// (see match-engine.ts) — 90 is the real ceiling, so the UI never renders a
// "/100" suffix that would misrepresent the scale.
function scoreTone(score: number): BadgeTone {
  if (score >= 70) return "ok";
  if (score >= 40) return "warn";
  return "neutral";
}

const REASON_LABELS: Record<ReasonCode, string> = {
  cnae_primary: "CNAE principal",
  cnae_secondary: "CNAE secundário",
  term_enrichment: "termos",
  term_text: "texto",
  state_ok: "UF",
  state_out: "fora da UF",
  value_ok: "valor",
  value_out: "fora da faixa",
  value_unknown: "valor desconhecido",
  me_epp_exclusive: "exclusivo ME/EPP",
  requires_certification: "exige certificação",
  requires_technical_certificate: "exige atestado",
  exclusion: "exclusão",
  semantic_high: "similar ao cadastro",
  semantic: "afinidade semântica",
  no_profile: "sem cadastro de match",
};

function reasonLabel(reason: Reason): string {
  return REASON_LABELS[reason.code] ?? reason.code;
}

function ReasonChip({ reason }: { reason: Reason }) {
  const label = reasonLabel(reason);

  if (reason.weight < 0) {
    // An exclusion is a hard negative — call it out with `danger`, a token the
    // shared Badge component doesn't expose a tone for. Other negatives
    // (state/value out of range, ME/EPP-only, requirements) get `warn`.
    if (reason.code === "exclusion") {
      return (
        <span
          title={reason.detail}
          className="inline-flex h-6 items-center rounded-[9999px] bg-danger/10 px-2.5 text-[13px] font-medium text-danger"
        >
          {label}
        </span>
      );
    }
    return (
      <span title={reason.detail}>
        <Badge tone="warn">{label}</Badge>
      </span>
    );
  }

  return (
    <span title={reason.detail}>
      <Badge tone="neutral">{label}</Badge>
    </span>
  );
}

export function ProcurementRefCard({
  item,
  index,
}: {
  item: ProcurementRef;
  index: number;
}) {
  const location = [item.city, item.state].filter(Boolean).join("/");
  const reasons = (item.reasons ?? []).slice(0, 4);

  return (
    <Link
      href={`/procurement/${encodeURIComponent(item.source_id)}`}
      className="flex flex-col gap-2 rounded-[10px] border border-line bg-surface p-3.5 hover:bg-surface-raised"
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5 shrink-0 text-xs font-semibold tabular-nums text-ink-faint">
          #{index}
        </span>
        <p className="line-clamp-2 text-sm font-medium text-ink">
          {item.description || "—"}
        </p>
      </div>

      <p className="truncate text-xs text-ink-muted">
        {item.agency || "—"}
        {location ? ` · ${location}` : ""}
        {item.modality ? ` · ${item.modality}` : ""}
      </p>

      <div className="flex flex-wrap items-center gap-1.5">
        <StatusBadge status={item.status} />
        {item.score !== undefined ? (
          <Badge tone={scoreTone(item.score)}>Aderência {item.score}</Badge>
        ) : null}
      </div>

      <div className="flex items-center justify-between text-xs text-ink-muted">
        <span className="tabular-nums text-ink">
          {formatCurrencyBRL(item.estimated_value)}
        </span>
        <span className="tabular-nums">{formatDateBR(item.closes_at)}</span>
      </div>

      {reasons.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {reasons.map((reason, idx) => (
            <ReasonChip key={`${reason.code}-${idx}`} reason={reason} />
          ))}
        </div>
      ) : null}
    </Link>
  );
}
