import Link from "next/link";
import { removeDocumentAction } from "@/app/(app)/company/documents/actions";
import { Button } from "@/components/ui/button";
import { X } from "@/components/ui/icons";
import { StatusDot, type StatusDotTone } from "@/components/ui/status-dot";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import type { DocumentRow } from "@/lib/document-queries";
import { formatDateBR } from "@/lib/format";
import { DOCUMENT_KINDS } from "@/lib/types";

const KIND_LABELS: Record<string, string> = Object.fromEntries(
  DOCUMENT_KINDS.map((kind) => [kind.value, kind.label]),
);

const EXPIRY_ALERT_DAYS = 30;

type DocumentStatus = "expired" | "expiring_soon" | "valid";

const STATUS_LABELS: Record<DocumentStatus, string> = {
  expired: "Vencido",
  expiring_soon: "Vence em breve",
  valid: "Válido",
};

const STATUS_TONES: Record<DocumentStatus, StatusDotTone> = {
  expired: "off",
  expiring_soon: "warn",
  valid: "ok",
};

function statusOf(doc: DocumentRow): DocumentStatus | null {
  if (!doc.valid_until) return null;
  if (doc.expired) return "expired";

  const limit = new Date();
  limit.setDate(limit.getDate() + EXPIRY_ALERT_DAYS);
  return new Date(doc.valid_until) <= limit ? "expiring_soon" : "valid";
}

function RemoveDocumentButton({ doc }: { doc: DocumentRow }) {
  return (
    <form action={removeDocumentAction}>
      <input type="hidden" name="id" value={doc.id} />
      <Button
        type="submit"
        variant="ghost"
        size="sm"
        aria-label={`Remover ${doc.file_name}`}
      >
        <X size={16} />
      </Button>
    </form>
  );
}

export function CompanyDocumentsTable({
  documents,
  isAdmin,
}: {
  documents: DocumentRow[];
  isAdmin: boolean;
}) {
  return (
    <>
      {/* Stacked-card reflow below `md` (ticket 45) — same fields as the
          table, tipo/arquivo prominent, validade/status/enviado secondary,
          ações in footer. */}
      <div className="flex flex-col gap-2.5 md:hidden">
        {documents.map((doc) => {
          const status = statusOf(doc);
          return (
            <div
              key={doc.id}
              className="flex flex-col gap-2.5 rounded-[10px] border border-line bg-surface p-3.5"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex flex-col gap-0.5">
                  <p className="text-sm font-medium text-ink">
                    {KIND_LABELS[doc.kind] ?? doc.kind}
                  </p>
                  <Link
                    href={`/company/documents/${doc.id}/download`}
                    className="truncate text-xs text-accent hover:underline"
                  >
                    {doc.file_name}
                  </Link>
                </div>
                {status ? (
                  <StatusDot tone={STATUS_TONES[status]} label={STATUS_LABELS[status]} />
                ) : null}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
                <span>Validade: {formatDateBR(doc.valid_until)}</span>
                <span>Enviado em: {formatDateBR(doc.created_at)}</span>
              </div>
              {isAdmin ? (
                <div className="border-t border-line pt-2.5">
                  <RemoveDocumentButton doc={doc} />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="hidden overflow-x-auto md:block">
        <Table density="compact">
          <THead>
            <TH>Tipo</TH>
            <TH>Arquivo</TH>
            <TH>Validade</TH>
            <TH>Status</TH>
            <TH>Enviado em</TH>
            {isAdmin ? <TH>Ações</TH> : null}
          </THead>
          <TBody>
            {documents.map((doc) => {
              const status = statusOf(doc);
              return (
                <TR key={doc.id}>
                  <TD>{KIND_LABELS[doc.kind] ?? doc.kind}</TD>
                  <TD>
                    <Link
                      href={`/company/documents/${doc.id}/download`}
                      className="text-accent hover:underline"
                    >
                      {doc.file_name}
                    </Link>
                  </TD>
                  <TD>{formatDateBR(doc.valid_until)}</TD>
                  <TD>
                    {status ? (
                      <StatusDot tone={STATUS_TONES[status]} label={STATUS_LABELS[status]} />
                    ) : (
                      "—"
                    )}
                  </TD>
                  <TD>{formatDateBR(doc.created_at)}</TD>
                  {isAdmin ? (
                    <TD>
                      <RemoveDocumentButton doc={doc} />
                    </TD>
                  ) : null}
                </TR>
              );
            })}
          </TBody>
        </Table>
      </div>
    </>
  );
}
