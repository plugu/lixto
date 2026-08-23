// Thin wrapper over the kit's StatusDot (cycle 8): status reads as a colored
// dot + text, not a bordered pill. Props are frozen (`{status}`) — the detail
// page imports this component too.
import { StatusDot, type StatusDotTone } from "@/components/ui/status-dot";
import { STATUS_LABELS, type StatusLicitacao } from "@/lib/status";

const TONES: Record<StatusLicitacao, StatusDotTone> = {
  aberta: "ok",
  vai_abrir: "warn",
  fechada: "off",
};

export function StatusBadge({ status }: { status: StatusLicitacao }) {
  return <StatusDot tone={TONES[status]} label={STATUS_LABELS[status]} />;
}
