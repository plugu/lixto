import { STATUS_LABELS, type StatusLicitacao } from "@/lib/status";

const STYLES: Record<StatusLicitacao, string> = {
  aberta: "bg-green-100 text-green-800",
  vai_abrir: "bg-amber-100 text-amber-800",
  fechada: "bg-gray-100 text-gray-600",
};

export function StatusBadge({ status }: { status: StatusLicitacao }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STYLES[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}
