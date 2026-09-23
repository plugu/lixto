// Case detail (ticket 169): the habilitação verdict, key dossier dates, and
// the operator's one decision. Tenant rule (docs/TENANT.md): `getCase` scopes
// by `company_id` itself, so a foreign or unknown id both 404 the same way.
import { notFound } from "next/navigation";
import Link from "next/link";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { CaseDecision } from "@/components/case-decision";
import { CaseOutcome } from "@/components/case-outcome";
import { CaseVerdictTable } from "@/components/case-verdict-table";
import { LinkButton } from "@/components/ui/button";
import { requireSession } from "@/lib/auth";
import { DATE_KIND_LABELS } from "@/lib/analysis-labels";
import { fetchAnalysis } from "@/lib/analysis-queries";
import {
  CASE_STATUS_LABELS,
  DECISION_LABELS,
  SESSION_SOURCE_LABELS,
} from "@/lib/case-labels";
import { getCase, listCaseChecks, type CaseStatus } from "@/lib/case-queries";
import { listDocuments } from "@/lib/document-queries";
import { formatCurrencyBRL, formatDateBR } from "@/lib/format";
import { getOpportunity } from "@/lib/opportunity-queries";
import { fetchDocuments } from "@/lib/procurement-detail-queries";

const STATUS_TONES: Record<CaseStatus, BadgeTone> = {
  waiting_analysis: "neutral",
  ready: "accent",
  decided: "ok",
};

// Tier-0 match-gate reasons worth surfacing on a case even though the
// recommendation already went GO — the operator still has to eyeball them
// (PRODUCT §Repo facts).
const PARTICIPATION_NOTES: Record<string, string> = {
  me_epp_exclusive: "Exclusivo ME/EPP — confira o porte da empresa",
  state_out: "Fora da UF do seu cadastro",
  value_out: "Fora da sua faixa de valor",
};

export default async function CaseDetailPage(props: PageProps<"/cases/[id]">) {
  const session = await requireSession();
  const { id: rawId } = await props.params;
  const id = Number(rawId);
  if (!Number.isInteger(id)) notFound();

  const companyId = session.user.companyId;
  const caseRow = await getCase(companyId, id);
  if (!caseRow) notFound();

  const [checks, documents, analysis, opportunity, companyDocuments] =
    await Promise.all([
      listCaseChecks(companyId, id),
      fetchDocuments(caseRow.procurement_id),
      fetchAnalysis(caseRow.procurement_id),
      getOpportunity(companyId, caseRow.source_id),
      listDocuments(companyId),
    ]);

  const hasValidDocument = companyDocuments.some(
    (document) => !document.expired,
  );

  const participationNotes = (opportunity?.reasons ?? [])
    .map((reason) => PARTICIPATION_NOTES[reason.code])
    .filter((note): note is string => Boolean(note));

  const location = [caseRow.city_name, caseRow.state_uf]
    .filter(Boolean)
    .join("/");
  const subtitle = [caseRow.agency_name, location, caseRow.modality_name]
    .filter(Boolean)
    .join(" · ");

  const statusLabel =
    caseRow.status === "decided" && caseRow.decision
      ? DECISION_LABELS[caseRow.decision]
      : CASE_STATUS_LABELS[caseRow.status];

  return (
    <div className="flex flex-col gap-6">
      <Card className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h1 className="font-display text-[22px] leading-7 text-ink">
              {caseRow.description || caseRow.source_id}
            </h1>
            {subtitle ? (
              <p className="text-[13px] text-ink-muted">{subtitle}</p>
            ) : null}
          </div>
          <Badge tone={STATUS_TONES[caseRow.status]}>{statusLabel}</Badge>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-muted">
          {caseRow.estimated_value ? (
            <span className="tabular-nums text-ink">
              {formatCurrencyBRL(caseRow.estimated_value)}
            </span>
          ) : null}
          <span>
            Sessão:{" "}
            {caseRow.session_at
              ? formatDateBR(caseRow.session_at)
              : "a confirmar"}
            {caseRow.session_at && caseRow.session_source
              ? ` (fonte: ${SESSION_SOURCE_LABELS[caseRow.session_source]})`
              : ""}
          </span>
          <Link
            href={`/procurement/${encodeURIComponent(caseRow.source_id)}`}
            className="font-medium text-accent hover:underline"
          >
            Ver licitação
          </Link>
        </div>

        {/* Header actions (ticket 171: bundle download). Kept as its own row
           so a later action — e.g. ticket 172's outcome card — can be added
           as a sibling <Card> below without touching this block. */}
        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3">
          {hasValidDocument ? (
            <LinkButton href={`/cases/${id}/bundle`}>
              Baixar documentos (zip)
            </LinkButton>
          ) : (
            <p className="text-[13px] text-ink-muted">
              Nenhum documento válido em{" "}
              <Link
                href="/company/documents"
                className="font-medium text-accent hover:underline"
              >
                Documentos
              </Link>
              .
            </p>
          )}
        </div>
      </Card>

      {participationNotes.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {participationNotes.map((note) => (
            <Badge key={note} tone="warn">
              {note}
            </Badge>
          ))}
        </div>
      ) : null}

      <Card className="flex flex-col gap-4">
        <h2 className="font-display text-[17px] leading-6 text-ink">
          Habilitação
        </h2>
        <CaseVerdictTable checks={checks} documents={documents} />
      </Card>

      {analysis ? (
        <Card className="flex flex-col gap-4">
          <h2 className="font-display text-[17px] leading-6 text-ink">
            Prazos
          </h2>
          {analysis.dates.length === 0 ? (
            <p className="text-sm text-ink-muted">Nenhum prazo extraído.</p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {analysis.dates.map((date) => (
                <li
                  key={date.sequence}
                  className="flex items-center justify-between gap-3"
                >
                  <span className="text-ink-muted">
                    {DATE_KIND_LABELS[date.kind]}
                  </span>
                  <span className="tabular-nums text-ink">
                    {date.occurs_at
                      ? formatDateBR(date.occurs_at)
                      : date.raw_text}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}

      <Card className="flex flex-col gap-4">
        <h2 className="font-display text-[17px] leading-6 text-ink">
          Sua decisão
        </h2>
        <CaseDecision
          caseId={caseRow.id}
          status={caseRow.status}
          decision={caseRow.decision}
          decisionNote={caseRow.decision_note}
          decidedAt={caseRow.decided_at}
          decidedByName={caseRow.decided_by_name}
        />
      </Card>

      <Card className="flex flex-col gap-4">
        <h2 className="font-display text-[17px] leading-6 text-ink">
          Resultado
        </h2>
        <CaseOutcome
          caseId={caseRow.id}
          decision={caseRow.decision}
          outcome={caseRow.outcome}
          outcomeSource={caseRow.outcome_source}
          outcomeAt={caseRow.outcome_at}
        />
      </Card>
    </div>
  );
}
