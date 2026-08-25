// Status derivation for procurements, expressed on the lixto columns
// `proposal_opens_at` / `proposal_closes_at`:
//
// open:     proposal_opens_at <= now() AND now() < proposal_closes_at
// upcoming: proposal_opens_at > now()
// closed:   proposal_closes_at < now() OR proposal_closes_at IS NULL
//
// The three windows are mutually exclusive here: open first, then upcoming,
// everything else falls to closed. The same predicates live in SQL in
// `procurement-queries.ts` / `stats-queries.ts`. Labels stay pt-BR.

export type ProcurementStatus = "open" | "upcoming" | "closed";

export const STATUS_LABELS: Record<ProcurementStatus, string> = {
  open: "Aberta",
  upcoming: "Vai abrir",
  closed: "Fechada",
};

export function computeProcurementStatus(
  opensAt: Date | string | null | undefined,
  closesAt: Date | string | null | undefined,
  now: Date = new Date(),
): ProcurementStatus {
  const opens = toDate(opensAt);
  const closes = toDate(closesAt);

  if (opens && closes && opens <= now && now < closes) return "open";
  if (opens && opens > now) return "upcoming";
  return "closed";
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? null : date;
}

// ---------------------------------------------------------------------------
// COMPAT (ticket 81 → removed by ticket 82)
//
// `lib/agent/*`, `components/chat/*` and `lib/format.test.ts` — none of which
// ticket 81 owns — import `computeStatus` / `StatusLicitacao` / the Portuguese
// status values from this path and assert on them. They keep the legacy
// behaviour until ticket 82 ports them; then this block goes away and
// `computeProcurementStatus` takes the `computeStatus` name.
// ---------------------------------------------------------------------------

export type StatusLicitacao = "aberta" | "vai_abrir" | "fechada";

const LEGACY_STATUS: Record<ProcurementStatus, StatusLicitacao> = {
  open: "aberta",
  upcoming: "vai_abrir",
  closed: "fechada",
};

export const LEGACY_STATUS_LABELS: Record<StatusLicitacao, string> = {
  aberta: "Aberta",
  vai_abrir: "Vai abrir",
  fechada: "Fechada",
};

export function computeStatus(
  dataAberturaProposta: Date | string | null | undefined,
  dataEncerramentoProposta: Date | string | null | undefined,
  now: Date = new Date(),
): StatusLicitacao {
  return LEGACY_STATUS[
    computeProcurementStatus(
      dataAberturaProposta,
      dataEncerramentoProposta,
      now,
    )
  ];
}
