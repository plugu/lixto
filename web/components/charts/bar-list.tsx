import type { CategoryCount } from "@/lib/stats-queries";

const numberFormat = new Intl.NumberFormat("pt-BR");

/** Horizontal bar list: magnitude comparison in a single hue (accent).
 * Bars ≤24px thick, 4px rounded data-end square at the baseline, value at
 * the tip in text ink (never on the mark), hairline row separators. */
export function BarList({ data }: { data: CategoryCount[] }) {
  const max = Math.max(1, ...data.map((d) => d.count));

  return (
    <ul className="flex flex-col">
      {data.map((d) => (
        <li
          key={d.label}
          className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 border-b border-line py-2 last:border-b-0 sm:grid-cols-[minmax(0,11rem)_1fr_auto]"
          title={`${d.label}: ${numberFormat.format(d.count)}`}
        >
          <span className="col-span-2 truncate text-[13px] text-ink-muted sm:col-span-1">
            {d.label}
          </span>
          <span className="h-4 overflow-hidden rounded-r-[4px]">
            <span
              className="block h-full rounded-r-[4px] bg-accent"
              style={{ width: `${Math.max(0.75, (d.count / max) * 100)}%` }}
            />
          </span>
          <span className="text-[13px] text-ink tabular-nums">
            {numberFormat.format(d.count)}
          </span>
        </li>
      ))}
    </ul>
  );
}
