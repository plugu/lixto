// Stacked-card reflow of the procurements table row, shown below `md`. Same
// data as the table row — objeto, órgão/localização, status, valor +
// encerramento — no columns dropped, no query changes.
import Link from "next/link";
import { StatusBadge } from "@/components/status-badge";
import { formatCurrencyBRL, formatDateBR } from "@/lib/format";
import type { ProcurementRow } from "@/lib/procurement-queries";
import type { ProcurementStatus } from "@/lib/status";

export function ProcurementCard({
  row,
  status,
}: {
  row: ProcurementRow;
  status: ProcurementStatus;
}) {
  const location = [row.city_name, row.state].filter(Boolean).join("/");

  return (
    <Link
      href={`/procurement/${encodeURIComponent(row.source_id)}`}
      className="flex flex-col gap-2 rounded-[10px] border border-line bg-surface p-3.5 active:bg-surface-raised"
    >
      <p className="line-clamp-2 text-sm font-medium text-ink">
        {row.description || "—"}
      </p>
      <p className="truncate text-xs text-ink-muted">
        {row.agency_name || "—"}
        {location ? ` · ${location}` : ""}
        {row.modality_name ? ` · ${row.modality_name}` : ""}
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        <StatusBadge status={status} />
      </div>
      <div className="flex items-center justify-between text-xs text-ink-muted">
        <span className="tabular-nums text-ink">
          {formatCurrencyBRL(row.estimated_value)}
        </span>
        <span className="tabular-nums">
          {formatDateBR(row.proposal_closes_at)}
        </span>
      </div>
    </Link>
  );
}
