"use client";

// Client toolbar for /radar (ticket 145). Same controls as the old
// `<form method="GET">` in app/(app)/radar/page.tsx, but no form and no
// "Aplicar": every control writes the URL through `useRadarFilters()`
// inside a transition, which re-renders `Results` (the async server
// component behind the page's Suspense boundary) while this toolbar stays
// mounted. Modelled on `components/filters.tsx` (ticket 144).

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Toolbar } from "@/components/ui/toolbar";
import type { RadarFilters } from "@/lib/radar-list-queries";
import { useRadarFilters } from "@/lib/radar-url";

const PERIOD_OPTIONS = [30, 60, 90, 180, 365] as const;

/** Local draft for a text/number control: reacts to the keystroke instantly
 * and re-syncs whenever the URL-derived value changes (the supported "adjust
 * state during render" pattern, no effect cascade). */
function useDraft<T>(value: T): [T, (next: T) => void] {
  const [draft, setDraft] = useState(value);
  const [synced, setSynced] = useState(value);
  if (synced !== value) {
    setSynced(value);
    setDraft(value);
  }
  return [draft, setDraft];
}

/** Trailing-edge debounce with an immediate `flush` escape hatch for blur/
 * Enter. The callback lives in a ref so both paths always call the newest
 * closure — i.e. against the newest filters. */
function useDebouncedCommit<A extends unknown[]>(
  callback: (...args: A) => void,
  delay: number,
): { commit: (...args: A) => void; flush: (...args: A) => void } {
  const callbackRef = useRef(callback);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // No dependency array: after every render the ref holds the newest closure,
  // long before a pending timer (>= `delay` ms away) can fire it.
  useEffect(() => {
    callbackRef.current = callback;
  });

  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    },
    [],
  );

  const clear = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const commit = useCallback(
    (...args: A) => {
      clear();
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        callbackRef.current(...args);
      }, delay);
    },
    [clear, delay],
  );

  const flush = useCallback(
    (...args: A) => {
      clear();
      callbackRef.current(...args);
    },
    [clear],
  );

  return { commit, flush };
}

/**
 * UF / período / valor mín/máx / aderência mín. The result headline and the
 * card grid come from `results.tsx`, streamed under this toolbar — this
 * component never awaits the database and stays mounted across every
 * filter change.
 */
export function RadarFilterToolbar({
  stateOptions,
}: {
  stateOptions: string[];
}) {
  const { filters, pending, setFilters } = useRadarFilters();

  const [minDraft, setMinDraft] = useDraft(
    filters.minValue !== null ? String(filters.minValue) : "",
  );
  const [maxDraft, setMaxDraft] = useDraft(
    filters.maxValue !== null ? String(filters.maxValue) : "",
  );
  const [scoreDraft, setScoreDraft] = useDraft(
    filters.minScore !== null ? String(filters.minScore) : "",
  );

  const filtersRef = useRef(filters);
  useEffect(() => {
    filtersRef.current = filters;
  }, [filters]);

  const applyNumber = useCallback(
    (key: "minValue" | "maxValue" | "minScore", value: string) => {
      const trimmed = value.trim();
      const parsed = trimmed ? Number(trimmed) : Number.NaN;
      setFilters({
        ...filtersRef.current,
        [key]: Number.isFinite(parsed) ? parsed : null,
      });
    },
    [setFilters],
  );

  const { commit: commitMinValue, flush: flushMinValue } = useDebouncedCommit(
    (value: string) => applyNumber("minValue", value),
    400,
  );
  const { commit: commitMaxValue, flush: flushMaxValue } = useDebouncedCommit(
    (value: string) => applyNumber("maxValue", value),
    400,
  );
  const { commit: commitMinScore, flush: flushMinScore } = useDebouncedCommit(
    (value: string) => applyNumber("minScore", value),
    400,
  );

  return (
    <div className="flex flex-col gap-2" aria-busy={pending}>
      <Toolbar className="flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="radar-state">UF</Label>
          <Select
            id="radar-state"
            value={filters.states[0] ?? ""}
            onChange={(event) => {
              const value = event.target.value;
              setFilters({ ...filters, states: value ? [value] : [] });
            }}
          >
            <option value="">Todas</option>
            {stateOptions.map((state) => (
              <option key={state} value={state}>
                {state}
              </option>
            ))}
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="radar-period">Período</Label>
          <Select
            id="radar-period"
            value={filters.period ? String(filters.period) : ""}
            onChange={(event) => {
              const value = event.target.value;
              const parsed = value
                ? (Number.parseInt(value, 10) as RadarFilters["period"])
                : null;
              setFilters({ ...filters, period: parsed });
            }}
          >
            <option value="">Todos os períodos</option>
            {PERIOD_OPTIONS.map((period) => (
              <option key={period} value={period}>
                {period} dias
              </option>
            ))}
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="radar-min-value">Valor mín. (R$)</Label>
          <Input
            id="radar-min-value"
            type="number"
            value={minDraft}
            onChange={(event) => {
              setMinDraft(event.target.value);
              commitMinValue(event.target.value);
            }}
            onBlur={(event) => flushMinValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") flushMinValue(event.currentTarget.value);
            }}
            placeholder="mín"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="radar-max-value">Valor máx. (R$)</Label>
          <Input
            id="radar-max-value"
            type="number"
            value={maxDraft}
            onChange={(event) => {
              setMaxDraft(event.target.value);
              commitMaxValue(event.target.value);
            }}
            onBlur={(event) => flushMaxValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") flushMaxValue(event.currentTarget.value);
            }}
            placeholder="máx"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="radar-min-score">Aderência mín.</Label>
          <Input
            id="radar-min-score"
            type="number"
            min={0}
            max={100}
            value={scoreDraft}
            onChange={(event) => {
              setScoreDraft(event.target.value);
              commitMinScore(event.target.value);
            }}
            onBlur={(event) => flushMinScore(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") flushMinScore(event.currentTarget.value);
            }}
            placeholder="0–100"
          />
        </div>
      </Toolbar>

      {/* 2px progress line under the toolbar, directly above the results —
          the visible half of `aria-busy` while a filter change is in
          flight. It lives here because `useTransition`'s pending flag is
          scoped to the component that starts the transition. */}
      <div
        aria-hidden="true"
        className={`h-0.5 rounded-full transition-colors ${
          pending ? "animate-pulse bg-accent" : "bg-transparent"
        }`}
      />
    </div>
  );
}

/**
 * Result pagination. A client control (not links) so it shares the one URL
 * writer with the filters and keeps the scroll position; rendered by
 * `components/radar/results.tsx`, which is the only place that knows how
 * many pages there are.
 */
export function Pagination({ totalPages }: { totalPages: number }) {
  const { page, pending, setPage } = useRadarFilters();

  if (totalPages <= 1) return null;

  const isFirst = page <= 1;
  const isLast = page >= totalPages;

  return (
    <div
      aria-busy={pending}
      className="flex items-center justify-end gap-3 text-[13px] text-ink-muted"
    >
      <span className="tabular-nums">
        Página {page} de {totalPages.toLocaleString("pt-BR")}
      </span>
      <Button
        variant="ghost"
        size="sm"
        disabled={isFirst}
        onClick={() => setPage(Math.max(1, page - 1))}
      >
        Anterior
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={isLast}
        onClick={() => setPage(Math.min(totalPages, page + 1))}
      >
        Próxima
      </Button>
    </div>
  );
}
