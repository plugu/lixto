"use client";

// Empresas table for /admin/companies (ticket 158). Approve/reject post to
// the two server actions in app/(app)/admin/companies/actions.ts; rows are
// filtered server-side by `status`, so every row on a given render shares
// the same approval_status — the badge tone/label is driven by the `status`
// prop rather than a per-row column the list query doesn't select.
import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";
import {
  approveCompanyAction,
  rejectCompanyAction,
} from "@/app/(app)/admin/companies/actions";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button, type ButtonVariant } from "@/components/ui/button";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatCNPJ } from "@/lib/br-validators";
import type { CompanyApprovalRow } from "@/lib/company-approval-queries";
import { formatDateBR } from "@/lib/format";
import type { ApprovalStatus } from "@/lib/types";

const STATUS_TONE: Record<ApprovalStatus, BadgeTone> = {
  pending: "warn",
  approved: "ok",
  rejected: "off",
};

const STATUS_LABEL: Record<ApprovalStatus, string> = {
  pending: "Pendente",
  approved: "Aprovada",
  rejected: "Rejeitada",
};

function SubmitButton({
  children,
  variant,
}: {
  children: ReactNode;
  variant: ButtonVariant;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} size="sm" disabled={pending}>
      {children}
    </Button>
  );
}

function ApproveForm({ companyId }: { companyId: number }) {
  return (
    <form action={approveCompanyAction}>
      <input type="hidden" name="companyId" value={companyId} />
      <SubmitButton variant="primary">Aprovar</SubmitButton>
    </form>
  );
}

function RejectForm({
  companyId,
  companyName,
}: {
  companyId: number;
  companyName: string;
}) {
  return (
    <details className="relative inline-block">
      <summary className="inline-flex h-[30px] min-h-11 cursor-pointer list-none items-center justify-center rounded-md bg-transparent px-3 text-[13px] font-medium text-ink-muted transition-colors hover:bg-surface-raised hover:text-ink focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent-soft md:min-h-0 [&::-webkit-details-marker]:hidden">
        Rejeitar
      </summary>
      <form
        action={rejectCompanyAction}
        onSubmit={(event) => {
          if (!confirm(`Rejeitar ${companyName}? A empresa perde o acesso.`)) {
            event.preventDefault();
          }
        }}
        className="absolute right-0 top-full z-10 mt-1 flex w-72 flex-col gap-2 rounded-md border border-line bg-surface p-3 shadow-md"
      >
        <input type="hidden" name="companyId" value={companyId} />
        <textarea
          name="reason"
          maxLength={500}
          rows={3}
          placeholder="Motivo (opcional)"
          aria-label="Motivo da rejeição (opcional)"
          className="w-full resize-none rounded-md border border-line bg-surface px-3 py-1.5 text-sm text-ink outline-none placeholder:text-ink-faint focus-visible:border-accent focus-visible:ring-[3px] focus-visible:ring-accent-soft"
        />
        <SubmitButton variant="primary">Confirmar rejeição</SubmitButton>
      </form>
    </details>
  );
}

function RowActions({ row, status }: { row: CompanyApprovalRow; status: ApprovalStatus }) {
  const companyName = row.trade_name ?? row.legal_name;
  if (status === "pending") {
    return (
      <div className="flex items-center gap-2">
        <ApproveForm companyId={row.id} />
        <RejectForm companyId={row.id} companyName={companyName} />
      </div>
    );
  }
  if (status === "approved") {
    return <RejectForm companyId={row.id} companyName={companyName} />;
  }
  return <ApproveForm companyId={row.id} />;
}

function StatusBadge({ status, reason }: { status: ApprovalStatus; reason: string | null }) {
  return (
    <Badge tone={STATUS_TONE[status]}>
      <span title={reason ?? undefined}>{STATUS_LABEL[status]}</span>
    </Badge>
  );
}

export function CompaniesTable({
  rows,
  status,
}: {
  rows: CompanyApprovalRow[];
  status: ApprovalStatus;
}) {
  return (
    <>
      {/* Stacked-card reflow below `md` (matches users-table.tsx): same
          fields, name prominent, actions in the footer. */}
      <div className="flex flex-col gap-2.5 md:hidden">
        {rows.map((row) => (
          <div
            key={row.id}
            className="flex flex-col gap-2.5 rounded-[10px] border border-line bg-surface p-3.5"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex flex-col gap-0.5">
                <p className="text-sm font-medium text-ink">{row.legal_name}</p>
                {row.trade_name ? (
                  <p className="truncate text-xs text-ink-muted">{row.trade_name}</p>
                ) : null}
              </div>
              <StatusBadge status={status} reason={row.approval_reason} />
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
              <span>{formatCNPJ(row.tax_id)}</span>
              <span>
                {row.city_name ?? "—"}/{row.state ?? "—"}
              </span>
              <span>{row.admin_name ?? "—"}</span>
              <span>{formatDateBR(row.created_at)}</span>
            </div>
            <div className="border-t border-line pt-2.5">
              <RowActions row={row} status={status} />
            </div>
          </div>
        ))}
      </div>

      <div className="hidden overflow-x-auto md:block">
        <Table density="compact">
          <THead>
            <TH>Empresa</TH>
            <TH>CNPJ</TH>
            <TH>Cidade/UF</TH>
            <TH>Admin</TH>
            <TH>Cadastro</TH>
            <TH>Situação</TH>
            <TH>Ações</TH>
          </THead>
          <TBody>
            {rows.map((row) => (
              <TR key={row.id}>
                <TD>
                  <div className="flex flex-col">
                    <span className="text-ink">{row.legal_name}</span>
                    {row.trade_name ? (
                      <span className="text-xs text-ink-muted">{row.trade_name}</span>
                    ) : null}
                  </div>
                </TD>
                <TD>{formatCNPJ(row.tax_id)}</TD>
                <TD>
                  {row.city_name ?? "—"}/{row.state ?? "—"}
                </TD>
                <TD>
                  <div className="flex flex-col">
                    <span className="text-ink">{row.admin_name ?? "—"}</span>
                    {row.admin_email ? (
                      <span className="text-xs text-ink-muted">{row.admin_email}</span>
                    ) : null}
                  </div>
                </TD>
                <TD>{formatDateBR(row.created_at)}</TD>
                <TD>
                  <StatusBadge status={status} reason={row.approval_reason} />
                </TD>
                <TD>
                  <RowActions row={row} status={status} />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </div>
    </>
  );
}
