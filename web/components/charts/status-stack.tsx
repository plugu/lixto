const numberFormat = new Intl.NumberFormat("pt-BR");

// Chart status palette — validated (dataviz six checks, light surface):
// green/amber/blue-slate, ΔE(protan) 8.0 backed by 2px gaps + direct labels.
const SEGMENTS = [
  { key: "abertas", label: "Abertas", color: "#299965" },
  { key: "vaiAbrir", label: "Vai abrir", color: "#CB750B" },
  { key: "fechadas", label: "Fechadas", color: "#4E6FBC" },
] as const;

type Counts = { abertas: number; vaiAbrir: number; fechadas: number };

/** Part-to-whole: one horizontal stacked bar, 2px surface gaps between
 * segments, legend row with swatch + value below (identity never color-alone). */
export function StatusStack({ counts }: { counts: Counts }) {
  const total = Math.max(1, counts.abertas + counts.vaiAbrir + counts.fechadas);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex h-5 w-full gap-[2px] overflow-hidden rounded-[4px]">
        {SEGMENTS.map((seg) => {
          const value = counts[seg.key];
          if (value === 0) return null;
          return (
            <div
              key={seg.key}
              title={`${seg.label}: ${numberFormat.format(value)}`}
              style={{
                width: `${(value / total) * 100}%`,
                backgroundColor: seg.color,
              }}
              className="h-full transition-opacity hover:opacity-80"
            />
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-1">
        {SEGMENTS.map((seg) => (
          <div key={seg.key} className="flex items-center gap-2 text-xs">
            <span
              className="h-2.5 w-2.5 rounded-[3px]"
              style={{ backgroundColor: seg.color }}
            />
            <span className="text-muted-foreground">{seg.label}</span>
            <span className="font-medium text-foreground tabular-nums">
              {numberFormat.format(counts[seg.key])}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
