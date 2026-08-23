"use client";

import { useMemo, useRef, useState } from "react";
import type { DailyCount } from "@/lib/stats-queries";

const numberFormat = new Intl.NumberFormat("pt-BR");

const W = 720;
const H = 180;
const PAD_L = 44;
const PAD_R = 16;
const PAD_T = 12;
const PAD_B = 24;

const ACCENT = "var(--color-accent)";
const LINE = "var(--color-line)";
const CROSSHAIR = "var(--color-ink-faint)";

function formatDay(iso: string): string {
  const [, month, day] = iso.split("-");
  return `${day}/${month}`;
}

/** Round the axis max up to a clean step so y ticks read as whole numbers. */
function niceMax(max: number): number {
  if (max <= 10) return 10;
  const pow = 10 ** Math.floor(Math.log10(max));
  const scaled = max / pow;
  const step = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
  return step * pow;
}

/** Single-series 30-day line: 2px round-capped line, 10% area wash, hairline
 * grid, crosshair + tooltip on hover (values also in the sr-only table). */
export function DailyLine({ data }: { data: DailyCount[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const { points, yMax, path, area, ticks } = useMemo(() => {
    const yMax = niceMax(Math.max(1, ...data.map((d) => d.count)));
    const innerW = W - PAD_L - PAD_R;
    const innerH = H - PAD_T - PAD_B;
    const points = data.map((d, i) => ({
      x: PAD_L + (data.length <= 1 ? 0 : (i / (data.length - 1)) * innerW),
      y: PAD_T + innerH - (d.count / yMax) * innerH,
      ...d,
    }));
    const path = points
      .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
      .join(" ");
    const baseline = PAD_T + innerH;
    const area = `${path} L${points[points.length - 1]?.x.toFixed(1)},${baseline} L${PAD_L},${baseline} Z`;
    const ticks = [0, 0.5, 1].map((f) => ({
      value: Math.round(yMax * f),
      y: PAD_T + innerH - f * innerH,
    }));
    return { points, yMax, path, area, ticks };
  }, [data]);

  function onPointerMove(event: React.PointerEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg || points.length === 0) return;
    const rect = svg.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * W;
    let nearest = 0;
    let best = Number.POSITIVE_INFINITY;
    for (let i = 0; i < points.length; i++) {
      const d = Math.abs(points[i].x - x);
      if (d < best) {
        best = d;
        nearest = i;
      }
    }
    setHover(nearest);
  }

  const hovered = hover !== null ? points[hover] : null;

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={`Licitações publicadas por dia nos últimos 30 dias, máximo ${numberFormat.format(yMax)}`}
        onPointerMove={onPointerMove}
        onPointerLeave={() => setHover(null)}
      >
        {ticks.map((t) => (
          <g key={t.value}>
            <line
              x1={PAD_L}
              x2={W - PAD_R}
              y1={t.y}
              y2={t.y}
              stroke={LINE}
              strokeWidth="1"
            />
            <text
              x={PAD_L - 8}
              y={t.y + 3}
              textAnchor="end"
              className="fill-ink-muted"
              fontSize="10"
            >
              {numberFormat.format(t.value)}
            </text>
          </g>
        ))}

        <path d={area} fill={ACCENT} opacity="0.1" />
        <path
          d={path}
          fill="none"
          stroke={ACCENT}
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {points.length > 0 && (
          <>
            <text
              x={points[0].x}
              y={H - 8}
              textAnchor="start"
              className="fill-ink-muted"
              fontSize="10"
            >
              {formatDay(points[0].day)}
            </text>
            <text
              x={points[points.length - 1].x}
              y={H - 8}
              textAnchor="end"
              className="fill-ink-muted"
              fontSize="10"
            >
              {formatDay(points[points.length - 1].day)}
            </text>
          </>
        )}

        {hovered && (
          <>
            <line
              x1={hovered.x}
              x2={hovered.x}
              y1={PAD_T}
              y2={H - PAD_B}
              stroke={CROSSHAIR}
              strokeWidth="1"
            />
            <circle
              cx={hovered.x}
              cy={hovered.y}
              r="4"
              fill={ACCENT}
              stroke="var(--color-surface)"
              strokeWidth="2"
            />
          </>
        )}
      </svg>

      {hovered && (
        <div
          className="pointer-events-none absolute -top-1 rounded-md bg-surface px-2.5 py-1.5 text-xs shadow-card"
          style={{
            left: `${(hovered.x / W) * 100}%`,
            transform: hovered.x > W / 2 ? "translateX(-110%)" : "translateX(10%)",
          }}
        >
          <span className="font-semibold text-ink tabular-nums">
            {numberFormat.format(hovered.count)}
          </span>{" "}
          <span className="text-ink-muted">
            em {formatDay(hovered.day)}
          </span>
        </div>
      )}

      <table className="sr-only">
        <caption>Licitações publicadas por dia (últimos 30 dias)</caption>
        <tbody>
          {data.map((d) => (
            <tr key={d.day}>
              <th scope="row">{formatDay(d.day)}</th>
              <td>{d.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
