"use client";

// Bridge that carries the facet counts and the result total from
// `results.tsx` — an async server component behind <Suspense> — up to the
// toolbar in `filters.tsx`, which renders immediately *outside* that
// boundary so it never remounts and can show its own pending state.
//
// Same shape as the column-visibility store in filters.tsx: a module-level
// value read through `useSyncExternalStore`, no provider, no context. The
// toolbar therefore treats counts as optional and simply shows them when they
// arrive (the fallback the ticket calls for when the toolbar cannot live
// inside Suspense). Values survive across navigations, so during a pending
// filter change the popover keeps the previous counts instead of emptying.

import { useEffect, useSyncExternalStore } from "react";
import type { FacetCounts } from "@/lib/procurement-queries";

export type FacetToolbarSnapshot = {
  facetCounts: FacetCounts;
  total: number;
};

export const EMPTY_FACET_COUNTS: FacetCounts = {
  modality: [],
  category: [],
  portal: [],
  status: [],
  state: [],
};

let snapshot: FacetToolbarSnapshot | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): FacetToolbarSnapshot | null {
  return snapshot;
}

/** Nothing is known during SSR — the results have not resolved yet. */
function getServerSnapshot(): FacetToolbarSnapshot | null {
  return null;
}

export function useFacetToolbar(): FacetToolbarSnapshot | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Rendered (invisibly) by `results.tsx` with the freshly fetched counts. */
export function FacetToolbarSource({
  facetCounts,
  total,
}: FacetToolbarSnapshot) {
  useEffect(() => {
    snapshot = { facetCounts, total };
    for (const listener of listeners) listener();
  }, [facetCounts, total]);

  return null;
}
