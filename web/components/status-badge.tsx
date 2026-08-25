// Thin wrapper over the kit's StatusDot (cycle 8): status reads as a colored
// dot + text, not a bordered pill. Props are frozen (`{status}`) — the list,
// the detail page and the chat cards all import this component.
import { StatusDot, type StatusDotTone } from "@/components/ui/status-dot";
import { STATUS_LABELS, type ProcurementStatus } from "@/lib/status";

const TONES: Record<ProcurementStatus, StatusDotTone> = {
  open: "ok",
  upcoming: "warn",
  closed: "off",
};

export function StatusBadge({ status }: { status: ProcurementStatus }) {
  return <StatusDot tone={TONES[status]} label={STATUS_LABELS[status]} />;
}
