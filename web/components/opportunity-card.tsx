// Server card for a company's opportunity (ticket 93): same visual language
// as `ProcurementRefCard`/`ProcurementCard` — score badge, reason chips — plus
// the GO/NO-GO verdict and the feedback slot neither of those needs.
//
// `ProcurementRefCard`'s tone/label maps aren't imported: its props are
// frozen (web/AGENTS.md merge note) and there's no shared labels module in
// this ticket's file list, so the small pieces are duplicated on purpose
// rather than reaching into a component that isn't ours to change.
import Link from "next/link";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { OpportunityFeedback } from "@/components/opportunity-feedback";
import { formatCurrencyBRL, formatDateBR } from "@/lib/format";
import type { OpportunityRow } from "@/lib/opportunity-queries";
import type { Reason, ReasonCode } from "@/lib/match-engine";

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

const VERDICT_LABELS: Record<
  NonNullable<OpportunityRow["verdict"]>,
  string
> = {
  go: "GO",
  no_go: "NO-GO",
  borderline: "Borderline",
};

function VerdictBadge({ verdict }: { verdict: NonNullable<OpportunityRow["verdict"]> }) {
  if (verdict === "no_go") {
    return (
      <span className="inline-flex h-6 items-center rounded-[9999px] bg-danger/10 px-2.5 text-[13px] font-medium text-danger">
        {VERDICT_LABELS[verdict]}
      </span>
    );
  }
  return (
    <Badge tone={verdict === "go" ? "ok" : "warn"}>{VERDICT_LABELS[verdict]}</Badge>
  );
}

export function OpportunityCard({ opportunity }: { opportunity: OpportunityRow }) {
  const location = [opportunity.city_name, opportunity.state_uf]
    .filter(Boolean)
    .join("/");
  const reasons = (opportunity.reasons ?? []).slice(0, 4);

  return (
    <div className="flex flex-col gap-2 rounded-[10px] border border-line bg-surface p-3.5">
      <div className="flex items-start justify-between gap-3">
        <Link
          href={`/procurement/${encodeURIComponent(opportunity.source_id)}`}
          className="line-clamp-2 text-sm font-medium text-ink hover:underline"
        >
          {opportunity.description || "—"}
        </Link>
        <Badge tone={scoreTone(opportunity.score)}>
          Aderência {opportunity.score}
        </Badge>
      </div>

      <p className="truncate text-xs text-ink-muted">
        {opportunity.agency_name || "—"}
        {location ? ` · ${location}` : ""}
        {opportunity.modality_name ? ` · ${opportunity.modality_name}` : ""}
      </p>

      <div className="flex items-center justify-between text-xs text-ink-muted">
        <span className="tabular-nums text-ink">
          {formatCurrencyBRL(opportunity.estimated_value)}
        </span>
        <span className="tabular-nums">
          {formatDateBR(opportunity.proposal_closes_at)}
        </span>
      </div>

      {reasons.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {reasons.map((reason, idx) => (
            <ReasonChip key={`${reason.code}-${idx}`} reason={reason} />
          ))}
        </div>
      ) : null}

      {opportunity.verdict ? (
        <details className="text-[13px] text-ink-muted">
          <summary className="flex cursor-pointer list-none items-center gap-1.5">
            <VerdictBadge verdict={opportunity.verdict} />
            <span>Ver justificativa</span>
          </summary>
          <p className="mt-1.5 leading-5">{opportunity.rationale || "—"}</p>
        </details>
      ) : null}

      <div className="pt-1">
        <OpportunityFeedback opportunityId={opportunity.id} />
      </div>
    </div>
  );
}
