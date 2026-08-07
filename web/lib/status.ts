// Status derivation for licitações, mirroring the v_abertas / v_futuras /
// v_encerradas view definitions in migrations/001_schema.sql.
//
// v_abertas:    data_abertura_proposta <= now() AND now() < data_encerramento_proposta
// v_futuras:    data_abertura_proposta > now()
// v_encerradas: data_encerramento_proposta < now() OR data_encerramento_proposta IS NULL
//
// The three windows are treated as mutually exclusive here: aberta first,
// then vai_abrir (futura), everything else falls to fechada. (mvp shortcut:
// the exact instant where data_encerramento_proposta === now() is neither
// "<" nor "<=" in the SQL views; we simply classify it as fechada.)

export type StatusLicitacao = "aberta" | "vai_abrir" | "fechada";

export const STATUS_LABELS: Record<StatusLicitacao, string> = {
  aberta: "Aberta",
  vai_abrir: "Vai abrir",
  fechada: "Fechada",
};

export function computeStatus(
  dataAberturaProposta: Date | string | null | undefined,
  dataEncerramentoProposta: Date | string | null | undefined,
  now: Date = new Date(),
): StatusLicitacao {
  const abertura = toDate(dataAberturaProposta);
  const encerramento = toDate(dataEncerramentoProposta);

  if (abertura && encerramento && abertura <= now && now < encerramento) {
    return "aberta";
  }
  if (abertura && abertura > now) {
    return "vai_abrir";
  }
  return "fechada";
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? null : date;
}
