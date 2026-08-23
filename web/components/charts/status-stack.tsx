const numberFormat = new Intl.NumberFormat("pt-BR");

// Status palette matches StatusDot semantics: Aberta=ok, Vai abrir=warn,
// Fechada=off (docs/design/cycle8-direction.md).
const SEGMENTS = [
  { key: "abertas", label: "Abertas", color: "var(--color-ok)" },
  { key: "vaiAbrir", label: "Vai abrir", color: "var(--color-warn)" },
  { key: "fechadas", label: "Fechadas", color: "var(--color-off)" },
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
              className="h-full"
            />
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-1">
        {SEGMENTS.map((seg) => (
          <div key={seg.key} className="flex items-center gap-2 text-[13px]">
            <span
              className="h-2.5 w-2.5 rounded-[3px]"
              style={{ backgroundColor: seg.color }}
            />
            <span className="text-ink-muted">{seg.label}</span>
            <span className="font-medium text-ink tabular-nums">
              {numberFormat.format(counts[seg.key])}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
