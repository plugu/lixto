// Thin wrapper over the kit's StatusDot (cycle 8): status reads as a colored
// dot + text, not a bordered pill. Props are frozen (`{status}`) — the list,
// the detail page and the chat cards all import this component.
import { StatusDot, type StatusDotTone } from "@/components/ui/status-dot";
import {
  LEGACY_STATUS_LABELS,
  STATUS_LABELS,
  type ProcurementStatus,
  type StatusLicitacao,
} from "@/lib/status";

const TONES: Record<ProcurementStatus, StatusDotTone> = {
  open: "ok",
  upcoming: "warn",
  closed: "off",
};

// Legacy values still flow in from components/chat/* (ticket 82 ports them).
const LEGACY_TONES: Record<StatusLicitacao, StatusDotTone> = {
  aberta: "ok",
  vai_abrir: "warn",
  fechada: "off",
};

export function StatusBadge({
  status,
}: {
  status: ProcurementStatus | StatusLicitacao;
}) {
  const isLegacy = status === "aberta" || status === "vai_abrir" || status === "fechada";
  return isLegacy ? (
    <StatusDot tone={LEGACY_TONES[status]} label={LEGACY_STATUS_LABELS[status]} />
  ) : (
    <StatusDot tone={TONES[status]} label={STATUS_LABELS[status]} />
  );
}
