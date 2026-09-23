// Cases list (ticket 169): every case the agent has built for this company,
// open ones first, then nearest session (buildListCases' ORDER BY). One card
// per case; the detail page is where the operator actually decides.
import type { Metadata } from "next";
import Link from "next/link";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { requireSession } from "@/lib/auth";
import {
  CASE_STATUS_LABELS,
  CHECK_STATUS_TONES,
  DECISION_LABELS,
  OUTCOME_LABELS,
} from "@/lib/case-labels";
import {
  listCases,
  type CaseOutcome,
  type CaseRow,
  type CaseStatus,
} from "@/lib/case-queries";
import type { CheckStatus } from "@/lib/case-verdict";
import { formatDateBR } from "@/lib/format";

export const metadata: Metadata = { title: "Casos" };
export const dynamic = "force-dynamic";

const STATUS_TONES: Record<CaseStatus, BadgeTone> = {
  waiting_analysis: "neutral",
  ready: "accent",
  decided: "ok",
};

const OUTCOME_TONES: Record<CaseOutcome, BadgeTone> = {
  won: "ok",
  lost: "off",
  disqualified: "warn",
};

// Rendering order of the non-zero count chips — the order the ticket's copy
// gives them in ("1 atende", "2 faltam", "1 vence antes", "1 verificar").
const COUNT_CHIP_ORDER: CheckStatus[] = ["met", "missing", "expiring", "manual"];

const COUNT_CHIP_LABELS: Record<CheckStatus, (n: number) => string> = {
  met: (n) => (n === 1 ? "1 atende" : `${n} atendem`),
  missing: (n) => (n === 1 ? "1 falta" : `${n} faltam`),
  expiring: (n) => (n === 1 ? "1 vence antes" : `${n} vencem antes`),
  manual: (n) => `${n} verificar`,
};

function CaseListCard({ caseRow }: { caseRow: CaseRow }) {
  const statusLabel =
    caseRow.status === "decided" && caseRow.decision
      ? DECISION_LABELS[caseRow.decision]
      : CASE_STATUS_LABELS[caseRow.status];

  return (
    <Link
      href={`/cases/${caseRow.id}`}
      className="block rounded-lg focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent-soft"
    >
      <Card className="flex flex-col gap-2 transition-colors hover:bg-surface-raised">
        <div className="flex items-start justify-between gap-3">
          <span className="line-clamp-2 text-sm font-medium text-ink">
            {caseRow.description || caseRow.source_id}
          </span>
          <Badge tone={STATUS_TONES[caseRow.status]}>{statusLabel}</Badge>
        </div>

        <p className="truncate text-xs text-ink-muted">
          {caseRow.agency_name || "—"}
          {caseRow.state_uf ? ` · ${caseRow.state_uf}` : ""}
        </p>

        <p className="text-xs text-ink-muted">
          Sessão:{" "}
          {caseRow.session_at
            ? formatDateBR(caseRow.session_at)
            : "a confirmar"}
        </p>

        <div className="flex flex-wrap gap-1.5">
          {COUNT_CHIP_ORDER.filter((status) => caseRow[status] > 0).map(
            (status) => (
              <Badge key={status} tone={CHECK_STATUS_TONES[status]}>
                {COUNT_CHIP_LABELS[status](caseRow[status])}
              </Badge>
            ),
          )}
          {caseRow.outcome ? (
            <Badge tone={OUTCOME_TONES[caseRow.outcome]}>
              {OUTCOME_LABELS[caseRow.outcome]}
            </Badge>
          ) : null}
        </div>
      </Card>
    </Link>
  );
}

export default async function CasesPage() {
  const session = await requireSession();
  const cases = await listCases(session.user.companyId);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Casos"
        subtitle="Oportunidades que o agente preparou para a sua decisão"
      />

      {cases.length === 0 ? (
        <EmptyState
          title="Nenhum caso ainda"
          hint="Quando uma recomendação GO surgir, o agente monta o caso aqui."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {cases.map((caseRow) => (
            <CaseListCard key={caseRow.id} caseRow={caseRow} />
          ))}
        </div>
      )}
    </div>
  );
}
