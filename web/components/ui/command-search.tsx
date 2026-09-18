"use client";

// The ⌘K command palette (ticket 149).
//
// Three exports, because the palette is opened from three places but must
// exist exactly once in the tree:
//   - `CommandPalette` — the dialog itself, mounted once by the sidebar
//     (which is `hidden md:flex`, but cmdk portals the dialog to <body>, so
//     it works on mobile too);
//   - `CommandSearch` — the sidebar's search button with the ⌘K hint;
//   - `CommandSearchButton` — the mobile top-bar icon button.
// Anything else can call `openCommandPalette()`.
//
// `lib/command-search-queries.ts` opens a pg Pool at module scope, so only
// its *types* may be imported here; the query itself runs in the server
// action.

import { Command } from "cmdk";
import { useRouter } from "next/navigation";
import {
  type ComponentType,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import { paletteSearchAction } from "@/app/(app)/search/actions";
import {
  COMPANY_ADMIN_ITEMS,
  COMPANY_ITEMS,
  NAV_ITEMS,
  SUPERADMIN_ITEMS,
} from "@/components/sidebar";
import { Search } from "@/components/ui/icons";
import type { CommandSearchRow } from "@/lib/command-search-queries";
import { formatShortcut, NAV_SHORTCUTS } from "@/lib/keyboard-shortcuts";

/** Mirrors `COMMAND_SEARCH_MIN_CHARS` (the server action re-checks it and is
 * the authority); here it only avoids a pointless round-trip. */
const MIN_QUERY_CHARS = 2;
const DEBOUNCE_MS = 250;

const RECENT_KEY = "lixto.recent";
const RECENT_LIMIT = 5;

type RecentProcurement = { sourceId: string; description: string };

type PaletteNavItem = {
  href: string;
  label: string;
  icon: ComponentType<{ size?: number }>;
};

// Open state (and the recents snapshot that goes with it) live in a module
// store so the sidebar button, the mobile top-bar button and the `?` shortcut
// all drive the single mounted dialog — and so the palette never has to read
// localStorage during render or from an effect body.
const NO_RECENTS: RecentProcurement[] = [];

let paletteOpen = false;
let recentsSnapshot: RecentProcurement[] = NO_RECENTS;
const paletteListeners = new Set<() => void>();

function subscribePalette(listener: () => void): () => void {
  paletteListeners.add(listener);
  return () => {
    paletteListeners.delete(listener);
  };
}

function getPaletteSnapshot(): boolean {
  return paletteOpen;
}

function getPaletteServerSnapshot(): boolean {
  return false;
}

function emitPalette() {
  for (const listener of paletteListeners) listener();
}

function setPaletteOpen(next: boolean) {
  if (paletteOpen === next) return;
  paletteOpen = next;
  // Recents are re-read on every open: another tab (or another visit) may
  // have written them since.
  if (next) recentsSnapshot = readRecents();
  emitPalette();
}

function getRecentsSnapshot(): RecentProcurement[] {
  return recentsSnapshot;
}

function getRecentsServerSnapshot(): RecentProcurement[] {
  return NO_RECENTS;
}

export function openCommandPalette() {
  setPaletteOpen(true);
}

function readRecents(): RecentProcurement[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (entry): entry is RecentProcurement =>
          typeof entry === "object" &&
          entry !== null &&
          typeof (entry as RecentProcurement).sourceId === "string" &&
          typeof (entry as RecentProcurement).description === "string",
      )
      .slice(0, RECENT_LIMIT);
  } catch {
    // localStorage unavailable or corrupt JSON — no recents, no crash.
    return [];
  }
}

function pushRecent(entry: RecentProcurement) {
  try {
    const next = [
      entry,
      ...readRecents().filter((item) => item.sourceId !== entry.sourceId),
    ].slice(0, RECENT_LIMIT);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    recentsSnapshot = next;
    emitPalette();
  } catch {
    // ignore: recents are a convenience, never a failure mode.
  }
}

/** Accent- and case-insensitive contains, matching how the server FTS treats
 * "licitacoes" and "licitações" the same. */
function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function procurementHref(sourceId: string): string {
  return `/procurement/${encodeURIComponent(sourceId)}`;
}

/** The sidebar's search button (expanded state). */
export function CommandSearch() {
  return (
    <button
      type="button"
      onClick={openCommandPalette}
      className="flex h-8 w-full items-center gap-2 rounded-md border border-line bg-surface px-2.5 text-[13px] text-ink-faint transition-colors hover:border-accent/40"
    >
      <Search size={14} />
      <span className="flex-1 text-left">Buscar</span>
      <span className="rounded border border-line px-1.5 py-0.5 text-[11px] text-ink-faint">
        ⌘K
      </span>
    </button>
  );
}

/** The mobile top-bar icon button. */
export function CommandSearchButton() {
  return (
    <button
      type="button"
      onClick={openCommandPalette}
      aria-label="Buscar"
      className="flex h-8 w-8 items-center justify-center rounded-md text-ink-muted hover:bg-surface-raised hover:text-ink"
    >
      <Search size={18} />
    </button>
  );
}

export function CommandPalette({ role, isSuperadmin }: { role: string; isSuperadmin: boolean }) {
  const open = useSyncExternalStore(
    subscribePalette,
    getPaletteSnapshot,
    getPaletteServerSnapshot,
  );
  const router = useRouter();
  const recents = useSyncExternalStore(
    subscribePalette,
    getRecentsSnapshot,
    getRecentsServerSnapshot,
  );
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CommandSearchRow[]>([]);
  const [isPending, startTransition] = useTransition();
  const requestId = useRef(0);

  const trimmed = query.trim();
  const searching = trimmed.length >= MIN_QUERY_CHARS;

  // Closing always clears the query: a palette reopens empty.
  const close = useCallback(() => {
    setPaletteOpen(false);
    setQuery("");
    setResults([]);
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        // Read the store, not the render-time `open`: this listener is bound
        // once and would otherwise close over a stale value.
        if (getPaletteSnapshot()) close();
        else setPaletteOpen(true);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [close]);

  function handleQueryChange(next: string) {
    setQuery(next);
    // Below the floor there is nothing to show — drop stale rows right away
    // instead of leaving them under a one-letter query.
    if (next.trim().length < MIN_QUERY_CHARS) setResults([]);
  }

  useEffect(() => {
    if (!open || !searching) return;
    const timer = setTimeout(() => {
      const id = requestId.current + 1;
      requestId.current = id;
      startTransition(async () => {
        const rows = await paletteSearchAction(trimmed);
        // Drop out-of-order answers from an earlier, slower keystroke.
        if (requestId.current === id) setResults(rows);
      });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [open, searching, trimmed]);

  const go = useCallback(
    (href: string) => {
      close();
      router.push(href);
    },
    [close, router],
  );

  const navItems = useMemo<PaletteNavItem[]>(
    () => [
      ...NAV_ITEMS,
      ...COMPANY_ITEMS,
      ...(role === "admin" ? COMPANY_ADMIN_ITEMS : []),
      ...(isSuperadmin ? SUPERADMIN_ITEMS : []),
    ],
    [role, isSuperadmin],
  );

  const needle = normalize(trimmed);
  const filteredNav = needle
    ? navItems.filter((item) => normalize(item.label).includes(needle))
    : navItems;
  const filteredRecents = needle
    ? recents.filter((item) => normalize(item.description).includes(needle))
    : recents;

  return (
    <Command.Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setPaletteOpen(true);
        else close();
      }}
      label="Buscar no Lixto"
      shouldFilter={false}
      loop
      overlayClassName="fixed inset-0 z-50 bg-ink/20"
      contentClassName="fixed left-1/2 top-[15vh] z-50 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2"
      className="overflow-hidden rounded-[10px] border border-line bg-surface shadow-[0_8px_24px_rgba(24,24,27,.1)]"
    >
      <div className="flex items-center gap-2 border-b border-line px-3">
        <Search size={16} className="shrink-0 text-ink-faint" />
        <Command.Input
          value={query}
          onValueChange={handleQueryChange}
          placeholder="Buscar licitações ou ir para…"
          className="h-11 w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
        />
      </div>

      <Command.List className="max-h-[320px] overflow-y-auto p-1.5">
        <Command.Empty className="px-3 py-6 text-center text-[13px] text-ink-muted">
          Nenhum resultado.
        </Command.Empty>

        {filteredNav.length > 0 ? (
          <Command.Group
            heading="Ir para"
            className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-faint"
          >
            {filteredNav.map((item) => {
              const shortcut = NAV_SHORTCUTS[item.href];
              return (
                <Command.Item
                  key={item.href}
                  value={`nav:${item.href}`}
                  onSelect={() => go(item.href)}
                  className="flex h-9 cursor-pointer items-center gap-2.5 rounded-md px-2 text-[13px] font-normal normal-case tracking-normal text-ink-muted data-[selected=true]:bg-surface-raised data-[selected=true]:text-ink"
                >
                  <item.icon size={16} />
                  <span>{item.label}</span>
                  {shortcut ? (
                    <span className="ml-auto text-[11px] text-ink-faint">
                      {formatShortcut(shortcut)}
                    </span>
                  ) : null}
                </Command.Item>
              );
            })}
          </Command.Group>
        ) : null}

        {filteredRecents.length > 0 ? (
          <Command.Group
            heading="Recentes"
            className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-faint"
          >
            {filteredRecents.map((item) => (
              <Command.Item
                key={item.sourceId}
                value={`recent:${item.sourceId}`}
                onSelect={() => {
                  pushRecent(item);
                  go(procurementHref(item.sourceId));
                }}
                className="flex h-9 cursor-pointer items-center gap-2.5 rounded-md px-2 text-[13px] font-normal normal-case tracking-normal text-ink-muted data-[selected=true]:bg-surface-raised data-[selected=true]:text-ink"
              >
                <span className="truncate">{item.description}</span>
              </Command.Item>
            ))}
          </Command.Group>
        ) : null}

        {isPending ? (
          <Command.Loading>
            <div className="px-3 py-3 text-[13px] text-ink-muted">Buscando…</div>
          </Command.Loading>
        ) : null}

        {searching ? (
          <Command.Group
            heading="Licitações"
            className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-faint"
          >
            {results.map((row) => (
              <Command.Item
                key={row.source_id}
                value={`procurement:${row.source_id}`}
                onSelect={() => {
                  pushRecent({
                    sourceId: row.source_id,
                    description: row.description ?? row.source_id,
                  });
                  go(procurementHref(row.source_id));
                }}
                className="flex cursor-pointer flex-col gap-0.5 rounded-md px-2 py-1.5 text-[13px] font-normal normal-case tracking-normal text-ink-muted data-[selected=true]:bg-surface-raised data-[selected=true]:text-ink"
              >
                <span className="truncate">
                  {row.description ?? row.source_id}
                </span>
                <span className="truncate text-[11px] text-ink-faint">
                  {[row.agency_name, row.state].filter(Boolean).join(" · ")}
                </span>
              </Command.Item>
            ))}
            <Command.Item
              value="all-results"
              onSelect={() =>
                go(`/procurements?q=${encodeURIComponent(trimmed)}`)
              }
              className="flex h-9 cursor-pointer items-center gap-2.5 rounded-md px-2 text-[13px] font-normal normal-case tracking-normal text-accent data-[selected=true]:bg-surface-raised"
            >
              Ver todos os resultados
            </Command.Item>
          </Command.Group>
        ) : null}
      </Command.List>

      <div className="flex items-center justify-end border-t border-line px-3 py-2 text-[11px] text-ink-faint">
        ↑↓ navegar · ↵ abrir · esc fechar
      </div>
    </Command.Dialog>
  );
}
