"use client";

// URL <-> filter-state plumbing for /procurements.
//
// The URL contract is frozen and *owned* by `parseFilters`
// (lib/procurement-queries.ts): `q`, repeated `portal` / `modality` /
// `status` / `segment` / `state`, plus `kind`, `valueMin`, `valueMax`,
// `compat=1`, `sort` and `page`. `buildProcurementQueryString` is its exact inverse.
//
// Why the read side is re-implemented here instead of importing
// `parseFilters`: `lib/procurement-queries.ts` opens a pg `Pool` at module
// scope, so a client component can only ever import *types* from it. The
// equivalence tests in `procurement-url.test.ts` run both parsers over the
// same fixtures, so this copy cannot silently drift from the server one.
//
// `nuqs` is deliberately not used for these params: its array parsers
// comma-join values, which would break the repeated-key contract
// (`?state=SP&state=RJ`). It stays reserved for the single-value pill tabs.

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useTransition } from "react";
import type {
  ProcurementFilters,
  ProcurementSort,
} from "@/lib/procurement-queries";
import type { ProcurementStatus } from "@/lib/status";

export const PROCUREMENTS_PATH = "/procurements";

/** Serialises filters (and an optional 1-based page) into the query string
 * `parseFilters` reads back. Page 1 is left implicit, and an absent/empty
 * field never emits a param, so the canonical URL for "no filters" is a bare
 * `/procurements`. */
export function buildProcurementQueryString(
  filters: ProcurementFilters,
  page?: number,
): string {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  filters.portals?.forEach((portal) => params.append("portal", portal));
  filters.modalityIds?.forEach((id) => params.append("modality", String(id)));
  filters.statuses?.forEach((status) => params.append("status", status));
  if (filters.kind) params.set("kind", filters.kind);
  filters.segments?.forEach((segment) => params.append("segment", segment));
  filters.states?.forEach((state) => params.append("state", state));
  if (filters.valueMin !== undefined) {
    params.set("valueMin", String(filters.valueMin));
  }
  if (filters.valueMax !== undefined) {
    params.set("valueMax", String(filters.valueMax));
  }
  if (filters.compat) params.set("compat", "1");
  if (filters.sort) params.set("sort", filters.sort);
  if (page && page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

/** Flattens a `URLSearchParams` into the shape Next hands a server page as
 * `searchParams` (repeated keys become arrays) — the bridge the round-trip
 * test uses to feed the real `parseFilters`. */
export function searchParamsToRecord(
  params: URLSearchParams,
): Record<string, string | string[] | undefined> {
  const record: Record<string, string | string[] | undefined> = {};
  for (const key of new Set(params.keys())) {
    const values = params.getAll(key);
    record[key] = values.length === 1 ? values[0] : values;
  }
  return record;
}

function nonEmptyValues(params: URLSearchParams, key: string): string[] {
  return params
    .getAll(key)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

// Mirrors `PROCUREMENT_SORTS` in lib/procurement-queries.ts (a value import
// is off-limits here — see the module header); the equivalence tests catch
// drift.
const SORTS: readonly ProcurementSort[] = [
  "closing_asc",
  "published_desc",
  "value_desc",
  "value_asc",
];

function isSort(value: string | undefined): value is ProcurementSort {
  return value !== undefined && (SORTS as readonly string[]).includes(value);
}

function parseNumberParam(raw: string | null): number | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
}

/** Client-side twin of `parseFilters`. Same rules, same drop-don't-throw
 * behaviour for malformed values (see the module header for why it exists). */
export function parseProcurementSearchParams(
  params: URLSearchParams,
): ProcurementFilters {
  const filters: ProcurementFilters = {};

  const q = params.get("q")?.trim();
  if (q) filters.q = q;

  const portals = nonEmptyValues(params, "portal");
  if (portals.length > 0) filters.portals = portals;

  const modalityIds = nonEmptyValues(params, "modality")
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isInteger(value));
  if (modalityIds.length > 0) filters.modalityIds = modalityIds;

  const statuses = nonEmptyValues(params, "status").filter(
    (value): value is ProcurementStatus =>
      value === "open" || value === "upcoming" || value === "closed",
  );
  if (statuses.length > 0) filters.statuses = statuses;

  const kind = params.get("kind")?.trim();
  if (kind === "product" || kind === "service" || kind === "mixed") {
    filters.kind = kind;
  }

  const segments = nonEmptyValues(params, "segment");
  if (segments.length > 0) filters.segments = segments;

  const states = nonEmptyValues(params, "state")
    .map((value) => value.toUpperCase())
    .filter((value) => /^[A-Z]{2}$/.test(value));
  if (states.length > 0) filters.states = states;

  const valueMin = parseNumberParam(params.get("valueMin"));
  if (valueMin !== undefined) filters.valueMin = valueMin;

  const valueMax = parseNumberParam(params.get("valueMax"));
  if (valueMax !== undefined) filters.valueMax = valueMax;

  if (params.get("compat") === "1") filters.compat = true;

  const sort = params.get("sort")?.trim();
  if (isSort(sort)) filters.sort = sort;

  return filters;
}

/** 1-based page number; anything unparseable or < 1 falls back to 1 (same
 * rule the server page applies). */
export function parseProcurementPage(params: URLSearchParams): number {
  return Math.max(1, Math.trunc(Number(params.get("page"))) || 1);
}

export type ProcurementFilterControls = {
  /** Filters currently encoded in the URL. */
  filters: ProcurementFilters;
  /** Current 1-based page. */
  page: number;
  /** True while a filter/page navigation started here is in flight. Scoped to
   * the calling component: `useTransition` is per-instance, so whichever
   * component triggers the change is the one that renders the pending state. */
  pending: boolean;
  /** Replaces the whole filter set and resets to page 1. */
  setFilters: (next: ProcurementFilters) => void;
  /** Keeps the filters, moves to `page`. */
  setPage: (page: number) => void;
};

/**
 * The single writer for the /procurements URL. Every control (search box,
 * multi-selects, value range, chips, pagination) goes through it, so the
 * frozen param contract lives in exactly one place and every change is a
 * client transition — no `<form method="GET">`, no document reload, and the
 * scroll position is preserved.
 */
export function useProcurementFilters(): ProcurementFilterControls {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  // `useSearchParams` returns a new object identity per render; the string
  // form is the stable memo key.
  const search = searchParams.toString();
  const filters = useMemo(
    () => parseProcurementSearchParams(new URLSearchParams(search)),
    [search],
  );
  const page = useMemo(
    () => parseProcurementPage(new URLSearchParams(search)),
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
        router.push(`${PROCUREMENTS_PATH}${queryString}`, { scroll: false });
      });
    },
    [router],
  );

  const setFilters = useCallback(
    (next: ProcurementFilters) => {
      // No `page` argument: any filter change resets to page 1.
      push(buildProcurementQueryString(next));
    },
    [push],
  );

  const setPage = useCallback(
    (nextPage: number) => {
      push(buildProcurementQueryString(filtersRef.current, nextPage));
    },
    [push],
  );

  return { filters, page, pending, setFilters, setPage };
}
