import { STATUS_LABELS, type StatusLicitacao } from "@/lib/status";

const STYLES: Record<StatusLicitacao, string> = {
  aberta: "border-met/30 bg-met/10 text-met",
  vai_abrir: "border-partial/30 bg-partial/10 text-partial",
  fechada: "border-unclear/30 bg-unclear/10 text-muted-foreground",
};

export function StatusBadge({ status }: { status: StatusLicitacao }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center self-start rounded-full border px-2.5 py-0.5 text-xs font-semibold ${STYLES[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}
