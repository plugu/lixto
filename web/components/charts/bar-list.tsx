import type { CategoryCount } from "@/lib/stats-queries";

const numberFormat = new Intl.NumberFormat("pt-BR");

/** Horizontal bar list: magnitude comparison in a single hue (accent).
 * Bars ≤24px thick, 4px rounded data-end square at the baseline, value at
 * the tip in text ink (never on the mark), row hover lift. */
export function BarList({ data }: { data: CategoryCount[] }) {
  const max = Math.max(1, ...data.map((d) => d.count));

  return (
    <ul className="flex flex-col gap-1">
      {data.map((d) => (
        <li
          key={d.label}
          className="group grid grid-cols-[minmax(0,11rem)_1fr_auto] items-center gap-3 rounded-md px-2 py-1.5 transition-colors hover:bg-muted/40"
          title={`${d.label}: ${numberFormat.format(d.count)}`}
        >
          <span className="truncate text-xs text-muted-foreground">
            {d.label}
          </span>
          <span className="h-4 overflow-hidden rounded-r-[4px]">
            <span
              className="block h-full rounded-r-[4px] bg-accent transition-opacity group-hover:opacity-80"
              style={{ width: `${Math.max(0.75, (d.count / max) * 100)}%` }}
            />
          </span>
          <span className="text-xs text-foreground tabular-nums">
            {numberFormat.format(d.count)}
          </span>
        </li>
      ))}
    </ul>
  );
}
