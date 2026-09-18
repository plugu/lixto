// "Back to the list" memory for the list → detail → list round trip.
//
// The list pages (/procurements, /radar) keep their whole filter/sort/page
// state in the URL and nowhere else. That is right for sharing and for the
// browser Back button, but an in-app "← Licitações" link with a static href
// lands on the bare list and silently drops the visitor's filters. So the
// list page records its current query string per tab, and the detail page's
// back link replays it.
//
// `sessionStorage` on purpose: per tab (two tabs with different filters do
// not fight), gone when the tab closes, never shared with other viewers. The
// pure helpers take the storage as a parameter so they are unit-testable
// without a DOM; the hooks below bind them to `window.sessionStorage`.

import { useEffect, useSyncExternalStore } from "react";

/** The subset of the Web Storage API these helpers touch. */
export type ListUrlStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;

export function lastListUrlKey(path: string): string {
  return `lixto.lastListUrl:${path}`;
}

/** `path` plus the remembered query string, or the bare `path` when nothing
 * is remembered, the value is not a query string, or storage is unavailable
 * (private mode, blocked site data, SSR). Never throws. */
export function readLastListUrl(
  storage: ListUrlStorage | null | undefined,
  path: string,
): string {
  if (!storage) return path;
  try {
    const search = storage.getItem(lastListUrlKey(path));
    // Only ever a same-route query string: the "?" prefix pins whatever
    // follows to `path`, so a tampered value cannot turn the link into a
    // redirect elsewhere.
    return search?.startsWith("?") ? `${path}${search}` : path;
  } catch {
    return path;
  }
}

/** Records `search` (with or without its leading "?") for `path`. An empty
 * query string clears the entry, so the bare list is remembered as bare. */
export function writeLastListUrl(
  storage: ListUrlStorage | null | undefined,
  path: string,
  search: string,
): void {
  if (!storage) return;
  try {
    const key = lastListUrlKey(path);
    const trimmed = search.startsWith("?") ? search.slice(1) : search;
    if (trimmed.length === 0) storage.removeItem(key);
    else storage.setItem(key, `?${trimmed}`);
  } catch {
    // Storage blocked or full: the back link simply falls back to the bare
    // list, which is today's behaviour.
  }
}

function sessionStorageOrNull(): ListUrlStorage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** List-page side: call with the current query string on every change. */
export function useRememberListUrl(path: string, search: string): void {
  useEffect(() => {
    writeLastListUrl(sessionStorageOrNull(), path, search);
  }, [path, search]);
}

const noopSubscribe = () => () => {};

/** Detail-page side: the href to send the visitor back to `path` with their
 * last filters. Renders the bare `path` on the server and during hydration,
 * then the remembered URL on the client. */
export function useLastListUrl(path: string): string {
  return useSyncExternalStore(
    noopSubscribe,
    () => readLastListUrl(sessionStorageOrNull(), path),
    () => path,
  );
}
