const compact = new Intl.NumberFormat("pt-BR", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const full = new Intl.NumberFormat("pt-BR");

export function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-card px-5 py-4 shadow-subtle">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p
        className="mt-1 text-2xl font-semibold text-foreground"
        title={full.format(value)}
      >
        {value >= 100_000 ? compact.format(value) : full.format(value)}
      </p>
    </div>
  );
}
