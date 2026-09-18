"use client";

import Link from "next/link";
import type { MouseEvent, ReactNode } from "react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { MultiSelect } from "@/components/multi-select";
import {
  EMPTY_FACET_COUNTS,
  useFacetToolbar,
} from "@/components/procurements/facet-toolbar";
import { Button } from "@/components/ui/button";
import { Columns, Filter, Search, Sort } from "@/components/ui/icons";
import { Input, Select } from "@/components/ui/input";
import { Popover } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { TD, TH } from "@/components/ui/table";
import { Toolbar, ToolbarButton } from "@/components/ui/toolbar";
import type {
  ProcurementFilters,
  ProcurementSort,
} from "@/lib/procurement-queries";
import { useProcurementFilters } from "@/lib/procurement-url";
import type { ProcurementStatus } from "@/lib/status";

type FiltersProps = {
  /** Renders the "Compatível com minha empresa" toggle only when the visitor
   * is logged in and their empresa has at least one CNAE — `compat` is also
   * stripped from the filter set in that case, so the checkbox, the chip and
   * the query the server runs always agree (`?compat=1` is a no-op when
   * logged out). */
  showCompat?: boolean;
};

/** `?compat=1` only counts for companies that have CNAEs — the same rule the
 * server page applies before querying. */
export function applyCompatGate(
  filters: ProcurementFilters,
  showCompat: boolean | undefined,
): ProcurementFilters {
  if (showCompat || filters.compat === undefined) return filters;
  const gated = { ...filters };
  delete gated.compat;
  return gated;
}

function countActiveFilters(filters: ProcurementFilters): number {
  return (
    (filters.statuses?.length ?? 0) +
    (filters.modalityIds?.length ?? 0) +
    (filters.categories?.length ?? 0) +
    (filters.states?.length ?? 0) +
    (filters.portals?.length ?? 0) +
    (filters.compat ? 1 : 0) +
    (filters.kind ? 1 : 0) +
    (filters.valueMin !== undefined ? 1 : 0) +
    (filters.valueMax !== undefined ? 1 : 0)
  );
}

function orUndefined<T>(values: T[]): T[] | undefined {
  return values.length > 0 ? values : undefined;
}

/** The kit Popover is `<details>/<summary>`; a `<button>` inside `<summary>`
 * swallows the native toggle in some browsers, so the trigger toggles it
 * explicitly (and cancels the native default so the two never cancel out). */
function togglePopover(event: MouseEvent<HTMLButtonElement>) {
  event.preventDefault();
  const details = event.currentTarget.closest("details");
  if (details) details.open = !details.open;
}

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

/** Trailing-edge debounce. The callback lives in a ref so the timer always
 * fires the newest closure — i.e. against the newest filters. */
function useDebouncedCallback<A extends unknown[]>(
  callback: (...args: A) => void,
  delay: number,
): (...args: A) => void {
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

  return useCallback(
    (...args: A) => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        callbackRef.current(...args);
      }, delay);
    },
    [delay],
  );
}

// ---------------------------------------------------------------------------
// Column visibility (Colunas menu) — client-only, persisted in localStorage.
// A module-level store read through useSyncExternalStore so the toolbar menu
// and the table cells share it without a provider and without a setState-in-
// effect hydration dance (server snapshot = everything visible).
// ---------------------------------------------------------------------------

export const TOGGLEABLE_COLUMNS = [
  { key: "modality", label: "Modalidade" },
  { key: "status", label: "Status" },
  { key: "value", label: "Valor estimado" },
  { key: "closing", label: "Encerramento" },
] as const;

export type ColumnKey = (typeof TOGGLEABLE_COLUMNS)[number]["key"];

type ColumnVisibility = Record<ColumnKey, boolean>;

const ALL_VISIBLE: ColumnVisibility = {
  modality: true,
  status: true,
  value: true,
  closing: true,
};

const STORAGE_KEY = "lixto.procurements.cols";

let store: ColumnVisibility | null = null;
const listeners = new Set<() => void>();

function readStorage(): ColumnVisibility {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return ALL_VISIBLE;
    const parsed = JSON.parse(raw) as Partial<Record<string, unknown>>;
    const next = { ...ALL_VISIBLE };
    for (const column of TOGGLEABLE_COLUMNS) {
      if (parsed[column.key] === false) next[column.key] = false;
    }
    return next;
  } catch {
    return ALL_VISIBLE;
  }
}

function getSnapshot(): ColumnVisibility {
  if (store === null) store = readStorage();
  return store;
}

function getServerSnapshot(): ColumnVisibility {
  return ALL_VISIBLE;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function toggleColumn(key: ColumnKey) {
  const current = getSnapshot();
  store = { ...current, [key]: !current[key] };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // storage unavailable — visibility still works for this session
  }
  for (const listener of listeners) listener();
}

function useColumnVisibility(): ColumnVisibility {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Header cell that disappears when its column is toggled off. */
export function ColTH({
  col,
  align,
  className,
  children,
}: {
  col?: ColumnKey;
  align?: "left" | "right" | "center";
  className?: string;
  children?: ReactNode;
}) {
  const visible = useColumnVisibility();
  if (col && !visible[col]) return null;
  return (
    <TH align={align} className={className}>
      {children}
    </TH>
  );
}

/** Body cell that disappears when its column is toggled off. */
export function ColTD({
  col,
  align,
  numeric,
  className,
  children,
}: {
  col?: ColumnKey;
  align?: "left" | "right" | "center";
  numeric?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  const visible = useColumnVisibility();
  if (col && !visible[col]) return null;
  return (
    <TD align={align} numeric={numeric} className={className}>
      {children}
    </TD>
  );
}

function ColumnsMenu() {
  const visible = useColumnVisibility();
  const hidden = TOGGLEABLE_COLUMNS.filter((c) => !visible[c.key]).length;

  return (
    <Popover
      trigger={
        <ToolbarButton
          icon={<Columns />}
          label="Colunas"
          count={hidden > 0 ? hidden : undefined}
          onClick={togglePopover}
        />
      }
    >
      <div className="w-56">
        <p className="px-2 pb-1 text-xs font-medium text-ink-muted">
          Colunas visíveis
        </p>
        <label className="flex cursor-not-allowed items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-ink-faint">
          <input
            type="checkbox"
            checked
            disabled
            readOnly
            className="h-3.5 w-3.5 rounded-[4px] accent-accent"
          />
          Objeto
        </label>
        {TOGGLEABLE_COLUMNS.map((column) => (
          <label
            key={column.key}
            className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-ink hover:bg-surface-raised"
          >
            <input
              type="checkbox"
              checked={visible[column.key]}
              onChange={() => toggleColumn(column.key)}
              className="h-3.5 w-3.5 rounded-[4px] accent-accent focus:outline-none focus-visible:ring-[3px] focus-visible:ring-accent-soft"
            />
            {column.label}
          </label>
        ))}
      </div>
    </Popover>
  );
}

/** Labels for the closed sort enum; the `Record` keeps this list and
 * `PROCUREMENT_SORTS` in lock-step at compile time. Order = menu order. */
const SORT_LABELS: Record<ProcurementSort, string> = {
  closing_asc: "Encerramento mais próximo",
  published_desc: "Publicação mais recente",
  value_desc: "Maior valor estimado",
  value_asc: "Menor valor estimado",
};

const SORT_OPTIONS = Object.keys(SORT_LABELS) as ProcurementSort[];

/** "Ordenar" menu: one radio per ordering plus the default. Writes
 * `filters.sort` through the shared URL writer, so a change is a transition
 * that swaps the results for the skeleton and resets to page 1. */
function SortMenu({
  active,
  setFilters,
}: {
  active: ProcurementFilters;
  setFilters: (next: ProcurementFilters) => void;
}) {
  const current = active.sort;
  const defaultLabel = active.q
    ? "Relevância (padrão)"
    : "Status e prazo (padrão)";

  return (
    <Popover
      trigger={
        <ToolbarButton
          icon={<Sort />}
          label="Ordenar"
          count={current ? 1 : undefined}
          onClick={togglePopover}
        />
      }
    >
      <div className="w-64" role="radiogroup" aria-label="Ordenar por">
        <p className="px-2 pb-1 text-xs font-medium text-ink-muted">
          Ordenar por
        </p>
        {[undefined, ...SORT_OPTIONS].map((option) => {
          const checked = option === current;
          return (
            <label
              key={option ?? "default"}
              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-ink hover:bg-surface-raised"
            >
              <input
                type="radio"
                name="procurement-sort"
                value={option ?? ""}
                checked={checked}
                onChange={() => {
                  if (checked) return;
                  setFilters({ ...active, sort: option });
                }}
                className="h-3.5 w-3.5 accent-accent focus:outline-none focus-visible:ring-[3px] focus-visible:ring-accent-soft"
              />
              {option ? SORT_LABELS[option] : defaultLabel}
            </label>
          );
        })}
      </div>
    </Popover>
  );
}

/**
 * Page header (title + result count + inline search) and the Attio-style
 * toolbar. There is no form and no "Aplicar": every control writes the URL
 * through `useProcurementFilters()` inside a transition, which re-renders the
 * server page below the Suspense boundary while this toolbar stays mounted.
 *
 * Result count and facet options come from `results.tsx` through the
 * facet-toolbar store — this component renders before those queries resolve,
 * so both are optional and simply appear when they arrive.
 */
export function Filters({ showCompat }: FiltersProps) {
  const { filters, pending, setFilters } = useProcurementFilters();
  const facets = useFacetToolbar();
  const facetCounts = facets?.facetCounts ?? EMPTY_FACET_COUNTS;

  const active = applyCompatGate(filters, showCompat);
  const activeCount = countActiveFilters(active);

  const [qDraft, setQDraft] = useDraft(active.q ?? "");
  const [minDraft, setMinDraft] = useDraft(
    active.valueMin !== undefined ? String(active.valueMin) : "",
  );
  const [maxDraft, setMaxDraft] = useDraft(
    active.valueMax !== undefined ? String(active.valueMax) : "",
  );

  const commitQ = useDebouncedCallback((value: string) => {
    const q = value.trim();
    setFilters({ ...active, q: q ? q : undefined });
  }, 300);

  const commitRange = useDebouncedCallback(
    (key: "valueMin" | "valueMax", value: string) => {
      const trimmed = value.trim();
      const parsed = trimmed ? Number(trimmed) : Number.NaN;
      const next: ProcurementFilters = { ...active };
      if (Number.isFinite(parsed)) next[key] = parsed;
      else delete next[key];
      setFilters(next);
    },
    300,
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="font-display text-[30px] leading-[34px] text-ink">
            Licitações
          </h1>
          {facets ? (
            <span className="text-[13px] tabular-nums text-ink-muted">
              {facets.total.toLocaleString("pt-BR")} resultados
            </span>
          ) : (
            <Skeleton className="h-3 w-24" />
          )}
        </div>
        {/* Same look as the kit's `SearchBox size="inline"`, inlined because
            that component renders its own <form> and this toolbar has none. */}
        <div className="flex h-[34px] w-full max-w-full items-center gap-2 rounded-md border border-line bg-surface px-3.5 text-[13px] text-ink focus-within:border-accent focus-within:ring-[3px] focus-within:ring-accent-soft sm:max-w-xs">
          <Search size={16} className="shrink-0 text-ink-faint" />
          <input
            value={qDraft}
            onChange={(event) => {
              setQDraft(event.target.value);
              commitQ(event.target.value);
            }}
            aria-label="Buscar licitações"
            placeholder="Buscar por objeto, órgão ou descreva o que você vende…"
            className="w-full bg-transparent outline-none placeholder:text-ink-faint"
          />
        </div>
      </div>

      <div className="flex flex-col gap-2" aria-busy={pending}>
        <Toolbar>
          <Popover
            trigger={
              <ToolbarButton
                icon={<Filter />}
                label="Filtrar"
                count={activeCount > 0 ? activeCount : undefined}
                onClick={togglePopover}
              />
            }
          >
            <div className="max-h-[70vh] w-[34rem] max-w-[calc(100vw-2rem)] overflow-y-auto">
              <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
                <MultiSelect
                  label="Status"
                  options={facetCounts.status}
                  selected={active.statuses ?? []}
                  onChange={(next) =>
                    setFilters({
                      ...active,
                      statuses: orUndefined(next as ProcurementStatus[]),
                    })
                  }
                />
                <MultiSelect
                  label="Modalidade"
                  options={facetCounts.modality}
                  selected={active.modalityIds?.map(String) ?? []}
                  onChange={(next) =>
                    setFilters({
                      ...active,
                      modalityIds: orUndefined(next.map(Number)),
                    })
                  }
                />
                <MultiSelect
                  label="Categoria"
                  options={facetCounts.category}
                  selected={active.categories ?? []}
                  onChange={(next) =>
                    setFilters({ ...active, categories: orUndefined(next) })
                  }
                />
                <MultiSelect
                  label="UF"
                  options={facetCounts.state}
                  selected={active.states ?? []}
                  onChange={(next) =>
                    setFilters({ ...active, states: orUndefined(next) })
                  }
                />
                <MultiSelect
                  label="Portal"
                  options={facetCounts.portal}
                  selected={active.portals ?? []}
                  onChange={(next) =>
                    setFilters({ ...active, portals: orUndefined(next) })
                  }
                />

                {showCompat && (
                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-ink-muted">
                      Empresa
                    </span>
                    <label className="flex cursor-pointer items-center gap-2 text-[13px] text-ink">
                      <input
                        type="checkbox"
                        checked={active.compat === true}
                        onChange={(event) =>
                          setFilters({
                            ...active,
                            compat: event.target.checked ? true : undefined,
                          })
                        }
                        className="h-3.5 w-3.5 rounded-[4px] accent-accent focus:outline-none focus-visible:ring-[3px] focus-visible:ring-accent-soft"
                      />
                      Compatível com minha empresa
                    </label>
                  </div>
                )}

                <div className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-ink-muted">
                    Tipo
                  </span>
                  <Select
                    aria-label="Tipo"
                    value={active.kind ?? ""}
                    onChange={(event) => {
                      const value = event.target.value;
                      setFilters({
                        ...active,
                        kind:
                          value === "product" ||
                          value === "service" ||
                          value === "mixed"
                            ? value
                            : undefined,
                      });
                    }}
                    className="max-w-none"
                  >
                    <option value="">Todos</option>
                    <option value="product">Produto</option>
                    <option value="service">Serviço</option>
                    <option value="mixed">Misto</option>
                  </Select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-ink-muted">
                    Valor estimado (R$)
                  </span>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      aria-label="Valor mínimo"
                      value={minDraft}
                      onChange={(event) => {
                        setMinDraft(event.target.value);
                        commitRange("valueMin", event.target.value);
                      }}
                      placeholder="mín"
                    />
                    <span aria-hidden="true" className="text-ink-faint">
                      –
                    </span>
                    <Input
                      type="number"
                      aria-label="Valor máximo"
                      value={maxDraft}
                      onChange={(event) => {
                        setMaxDraft(event.target.value);
                        commitRange("valueMax", event.target.value);
                      }}
                      placeholder="máx"
                    />
                  </div>
                </div>
              </div>

              <div className="mt-4 flex items-center justify-end border-t border-line pt-3">
                <Link
                  href="/procurements"
                  className="text-[13px] font-medium text-ink-muted hover:text-ink"
                >
                  Limpar filtros
                </Link>
              </div>
            </div>
          </Popover>

          <SortMenu active={active} setFilters={setFilters} />

          <ColumnsMenu />
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
    </div>
  );
}

/**
 * Result pagination. A client control (not links) so it shares the one URL
 * writer with the filters and keeps the scroll position; rendered by
 * `components/procurements/results.tsx`, which is the only place that knows
 * how many pages there are.
 */
export function Pagination({ totalPages }: { totalPages: number }) {
  const { page, pending, setPage } = useProcurementFilters();

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
