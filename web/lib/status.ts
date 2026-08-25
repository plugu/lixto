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
