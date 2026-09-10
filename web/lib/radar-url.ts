"use client";

// URL <-> filter-state plumbing for /radar (ticket 145). Mirrors
// lib/procurement-url.ts (ticket 144) exactly.
//
// The URL contract is frozen and *owned* by `parseRadarFilters`
// (lib/radar-list-queries.ts): `view`, repeated `state`, `period`,
// `minValue`, `maxValue`, `minScore`, plus `page`. `buildRadarQueryString`
// is its exact inverse.
//
// Why the read side is re-implemented here instead of importing
// `parseRadarFilters`: `lib/radar-list-queries.ts` opens a pg `Pool` at
// module scope, so a client component can only ever import *types* from it.
// The equivalence tests in `radar-url.test.ts` run both parsers over the
// same fixtures, so this copy cannot silently drift from the server one.

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useTransition } from "react";
import type { RadarFilters, RadarPeriod, RadarView } from "@/lib/radar-list-queries";
// Relative import (not "@/lib/...") on purpose: vitest runs without a config
// file, so the tsconfig "@/" alias is not resolvable from lib tests (see
// lib/radar-list-queries.ts).
import { RADAR_VIEW_DEFAULT, RADAR_VIEWS } from "./url-state";

export const RADAR_PATH = "/radar";

const VALID_PERIODS: readonly RadarPeriod[] = [30, 60, 90, 180, 365];

/** Serialises radar filters (and an optional 1-based page) into the query
 * string `parseRadarFilters` reads back. Page 1 and the default view
 * (`"all"`) are left implicit, and an absent/empty field never emits a
 * param, so the canonical URL for "no filters" is a bare `/radar`. */
export function buildRadarQueryString(
  filters: RadarFilters,
  page?: number,
): string {
  const params = new URLSearchParams();
  if (filters.view !== RADAR_VIEW_DEFAULT) params.set("view", filters.view);
  filters.states.forEach((state) => params.append("state", state));
  if (filters.period !== null) params.set("period", String(filters.period));
  if (filters.minValue !== null) {
    params.set("minValue", String(filters.minValue));
  }
  if (filters.maxValue !== null) {
    params.set("maxValue", String(filters.maxValue));
  }
  if (filters.minScore !== null) {
    params.set("minScore", String(filters.minScore));
  }
  if (page && page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

function nonEmptyValues(params: URLSearchParams, key: string): string[] {
  return params
    .getAll(key)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function parseNumberParam(raw: string | null): number | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

function parsePeriodParam(raw: string | null): RadarPeriod | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  const n = Number.parseInt(trimmed, 10);
  return (VALID_PERIODS as readonly number[]).includes(n)
    ? (n as RadarPeriod)
    : null;
}

function parseViewParam(raw: string | null): RadarView {
  return (RADAR_VIEWS as readonly string[]).includes(raw ?? "")
    ? (raw as RadarView)
    : RADAR_VIEW_DEFAULT;
}

/** Client-side twin of `parseRadarFilters`. Same rules, same drop-don't-throw
 * behaviour for malformed values (see the module header for why it exists). */
export function parseRadarSearchParams(params: URLSearchParams): RadarFilters {
  const states = nonEmptyValues(params, "state")
    .map((value) => value.toUpperCase())
    .filter((value) => /^[A-Z]{2}$/.test(value));

  return {
    view: parseViewParam(params.get("view")),
    states,
    period: parsePeriodParam(params.get("period")),
    minValue: parseNumberParam(params.get("minValue")),
    maxValue: parseNumberParam(params.get("maxValue")),
    minScore: parseNumberParam(params.get("minScore")),
  };
}

/** 1-based page number; anything unparseable or < 1 falls back to 1 (same
 * rule the server page applies). */
export function parseRadarPage(params: URLSearchParams): number {
  return Math.max(1, Math.trunc(Number(params.get("page"))) || 1);
}

export type RadarFilterControls = {
  /** Filters currently encoded in the URL. */
  filters: RadarFilters;
  /** Current 1-based page. */
  page: number;
  /** True while a filter/page navigation started here is in flight. Scoped to
   * the calling component: `useTransition` is per-instance, so whichever
   * component triggers the change is the one that renders the pending state. */
  pending: boolean;
  /** Replaces the whole filter set and resets to page 1. */
  setFilters: (next: RadarFilters) => void;
  /** Keeps the filters, moves to `page`. */
  setPage: (page: number) => void;
};

/**
 * The single writer for the /radar URL (besides the `view` pill tabs, which
 * go through `nuqs` directly — see `components/ui/pill-tabs.tsx`). Every
 * other control (UF, período, valor mín/máx, aderência mín, pagination)
 * goes through it, so the frozen param contract lives in exactly one place
 * and every change is a client transition — no `<form method="GET">`, no
 * document reload, and the scroll position is preserved.
 */
export function useRadarFilters(): RadarFilterControls {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  // `useSearchParams` returns a new object identity per render; the string
  // form is the stable memo key.
  const search = searchParams.toString();
  const filters = useMemo(
    () => parseRadarSearchParams(new URLSearchParams(search)),
    [search],
  );
  const page = useMemo(
    () => parseRadarPage(new URLSearchParams(search)),
    [search],
  );

  // Debounced callers fire after their render is gone; the ref keeps the
  // filters they rebuild from current.
  const filtersRef = useRef(filters);
  useEffect(() => {
    filtersRef.current = filters;
  }, [filters]);

  const push = useCallback(
    (queryString: string) => {
      startTransition(() => {
        router.push(`${RADAR_PATH}${queryString}`, { scroll: false });
      });
    },
    [router],
  );

  const setFilters = useCallback(
    (next: RadarFilters) => {
      // No `page` argument: any filter change resets to page 1.
      push(buildRadarQueryString(next));
    },
    [push],
  );

  const setPage = useCallback(
    (nextPage: number) => {
      push(buildRadarQueryString(filtersRef.current, nextPage));
    },
    [push],
  );

  return { filters, page, pending, setFilters, setPage };
}
