// Administração → Empresas (ticket 158): superadmin approval queue. Page
// shape copied from web/app/(app)/company/users/page.tsx (Section, tabs,
// client table); tabs use PillTabs like web/app/(app)/radar/page.tsx, but
// `status` (unlike `view`) is also what the query itself filters on, so the
// server page re-parses the same param PillTabs writes rather than sharing
// state with it.
import type { Metadata } from "next";
import { CompaniesTable } from "@/components/admin/companies-table";
import { PillTabs } from "@/components/ui/pill-tabs";
import { Section } from "@/components/ui/section";
import { requireSuperadmin } from "@/lib/auth";
import {
  countPendingCompanies,
  listCompaniesByStatus,
} from "@/lib/company-approval-queries";
import { APPROVAL_STATUSES, type ApprovalStatus } from "@/lib/types";

export const metadata: Metadata = { title: "Administração · Empresas" };
export const dynamic = "force-dynamic";

const STATUS_DEFAULT: ApprovalStatus = "pending";

/** Mirrors `parseOpportunityView` (lib/url-state.ts): unknown/array-valued
 * `?status=` falls back to the default instead of throwing. */
function parseStatus(raw: string | string[] | undefined): ApprovalStatus {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return (APPROVAL_STATUSES as readonly string[]).includes(value ?? "")
    ? (value as ApprovalStatus)
    : STATUS_DEFAULT;
}

const EMPTY_COPY: Record<ApprovalStatus, string> = {
  pending: "Nenhuma empresa aguardando aprovação.",
  approved: "Nenhuma empresa aprovada.",
  rejected: "Nenhuma empresa rejeitada.",
};

export default async function AdminCompaniesPage({
  searchParams,
}: PageProps<"/admin/companies">) {
  await requireSuperadmin();

  const resolvedSearchParams = await searchParams;
  const status = parseStatus(resolvedSearchParams.status);

  const [rows, pendingCount] = await Promise.all([
    listCompaniesByStatus(status),
    countPendingCompanies(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <Section eyebrow="Administração" title="Empresas">
        <p className="text-sm text-ink-muted">
          Aprove ou rejeite empresas cadastradas no Lixto.
        </p>
      </Section>

      <PillTabs
        param="status"
        options={[
          { value: "pending" as const, label: `Pendentes (${pendingCount})` },
          { value: "approved" as const, label: "Aprovadas" },
          { value: "rejected" as const, label: "Rejeitadas" },
        ]}
        defaultValue={STATUS_DEFAULT}
        ariaLabel="Filtrar empresas por status"
      />

      {rows.length === 0 ? (
        <p className="text-sm text-ink-muted">{EMPTY_COPY[status]}</p>
      ) : (
        <CompaniesTable rows={rows} status={status} />
      )}
    </div>
  );
}
