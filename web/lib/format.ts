// Formatting helpers for pt-BR display (docs/WEB_STYLE.md).

const currencyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "America/Sao_Paulo",
});

const timeFormatter = new Intl.DateTimeFormat("pt-BR", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "America/Sao_Paulo",
});

/** Formats a numeric value as R$ 1.234,56. Returns "—" for null/undefined/NaN. */
export function formatCurrencyBRL(
  value: number | string | null | undefined,
): string {
  if (value === null || value === undefined) return "—";
  const num = typeof value === "string" ? Number(value) : value;
  if (Number.isNaN(num)) return "—";
  return currencyFormatter.format(num);
}

/** Formats a date as dd/mm/aaaa, or dd/mm/aaaa HH:mm when withTime is true. */
export function formatDateBR(
  value: Date | string | null | undefined,
  withTime = false,
): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  const datePart = dateFormatter.format(date);
  if (!withTime) return datePart;
  return `${datePart} ${timeFormatter.format(date)}`;
}
