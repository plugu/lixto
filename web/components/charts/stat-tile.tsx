const compact = new Intl.NumberFormat("pt-BR", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const full = new Intl.NumberFormat("pt-BR");

/** Flat, tone-separated tile (surface-raised on canvas) — no border, no shadow. */
export function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[10px] bg-surface-raised px-5 py-4">
      <p className="text-xs font-medium text-ink-muted">{label}</p>
      <p
        className="mt-1 font-display text-[26px] leading-[1.2] text-ink"
        title={full.format(value)}
      >
        {value >= 100_000 ? compact.format(value) : full.format(value)}
      </p>
    </div>
  );
}
