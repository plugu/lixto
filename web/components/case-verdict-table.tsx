// Verdict table for a case's habilitação checklist (ticket 169): one row per
// requirement × document kind (`case_checks`, computed by case-verdict.ts),
// citing back to the dossier page the requirement itself cites.

import { CitationLinks } from "@/components/citation-link";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import {
  REQUIREMENT_CATEGORY_LABELS,
  SEVERITY_LABELS,
} from "@/lib/analysis-labels";
import {
  CHECK_STATUS_LABELS,
  CHECK_STATUS_TONES,
  documentKindLabel,
} from "@/lib/case-labels";
import type { CaseCheckRow } from "@/lib/case-queries";
import { formatDateBR } from "@/lib/format";
import type { DocumentRow } from "@/lib/procurement-detail-queries";

function requirementSubtitle(check: CaseCheckRow): string {
  return [
    REQUIREMENT_CATEGORY_LABELS[check.category],
    check.mandatory ? "obrigatória" : null,
    SEVERITY_LABELS[check.severity],
  ]
    .filter(Boolean)
    .join(" · ");
}

export function CaseVerdictTable({
  checks,
  documents,
}: {
  checks: CaseCheckRow[];
  documents: DocumentRow[];
}) {
  if (checks.length === 0) {
    return (
      <p className="text-sm text-ink-muted">
        Nenhuma exigência de habilitação extraída do edital.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto -mx-4 px-4 sm:-mx-6 sm:px-6">
      <Table density="compact">
        <THead bg="surface">
          <TH>Exigência</TH>
          <TH>Documento</TH>
          <TH>Situação</TH>
        </THead>
        <TBody>
          {checks.map((check) => (
            <TR key={check.id}>
              <TD className="max-w-[28rem] whitespace-normal break-words align-top">
                <p className="font-medium text-ink">{check.title}</p>
                <p className="text-xs text-ink-muted">
                  {requirementSubtitle(check)}
                  <CitationLinks
                    citations={check.citations}
                    documents={documents}
                  />
                </p>
              </TD>
              <TD className="align-top">
                {check.document_kind ? (
                  <>
                    <p className="text-ink">
                      {documentKindLabel(check.document_kind)}
                    </p>
                    {check.document_file_name ? (
                      <p className="text-xs text-ink-muted">
                        {check.document_file_name}
                        {check.document_valid_until
                          ? ` · válido até ${formatDateBR(check.document_valid_until)}`
                          : ""}
                      </p>
                    ) : null}
                  </>
                ) : (
                  <span className="text-ink-muted">—</span>
                )}
              </TD>
              <TD className="align-top">
                <Badge tone={CHECK_STATUS_TONES[check.status]}>
                  {CHECK_STATUS_LABELS[check.status]}
                </Badge>
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  );
}
