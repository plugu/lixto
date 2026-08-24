"use client";

import Link from "next/link";
import type { MouseEvent, ReactNode } from "react";
import { useSyncExternalStore } from "react";
import { MultiSelect } from "@/components/multi-select";
import { Button } from "@/components/ui/button";
import { Columns, Filter, Search, Sort } from "@/components/ui/icons";
import { Input, Select } from "@/components/ui/input";
import { Popover } from "@/components/ui/popover";
import { TD, TH } from "@/components/ui/table";
import { Toolbar, ToolbarButton } from "@/components/ui/toolbar";
import type { FacetCounts, LicitacaoFilters } from "@/lib/queries";

type FiltersProps = {
  filters: LicitacaoFilters;
  facetCounts: FacetCounts;
  total: number;
  /** Renders the "Compatível com minha empresa" toggle (ticket 52) only when
   * the visitor is logged in and their empresa has at least one CNAE — the
   * page strips `filters.compat` in that case too, so the checkbox and the
   * active filter it represents always agree. */
  showCompat?: boolean;
};

// Fit has no facet counts this cycle (ticket 15) — static options, count 0
// (MultiSelect hides zero counts).
const FIT_OPTIONS = [
  { value: "fit", label: "Fit", count: 0 },
  { value: "borderline", label: "Borderline", count: 0 },
  { value: "no_fit", label: "No fit", count: 0 },
  { value: "sem_analise", label: "Sem análise", count: 0 },
];

function countActiveFilters(filters: LicitacaoFilters): number {
  return (
    (filters.statuses?.length ?? 0) +
    (filters.modalidadeIds?.length ?? 0) +
    (filters.setores?.length ?? 0) +
    (filters.ufs?.length ?? 0) +
    (filters.portais?.length ?? 0) +
    (filters.fit?.length ?? 0) +
    (filters.compat ? 1 : 0) +
    (filters.categoria ? 1 : 0) +
    (filters.valorMin !== undefined ? 1 : 0) +
    (filters.valorMax !== undefined ? 1 : 0)
  );
}

/** The kit Popover is `<details>/<summary>`; a `<button>` inside `<summary>`
 * swallows the native toggle in some browsers, so the trigger toggles it
 * explicitly (and cancels the native default so the two never cancel out). */
function togglePopover(event: MouseEvent<HTMLButtonElement>) {
  event.preventDefault();
  const details = event.currentTarget.closest("details");
  if (details) details.open = !details.open;
}

// ---------------------------------------------------------------------------
// Column visibility (Colunas menu) — client-only, persisted in localStorage.
// A module-level store read through useSyncExternalStore so the toolbar menu
// and the table cells share it without a provider and without a setState-in-
// effect hydration dance (server snapshot = everything visible).
// ---------------------------------------------------------------------------

export const TOGGLEABLE_COLUMNS = [
  { key: "modalidade", label: "Modalidade" },
  { key: "status", label: "Status" },
  { key: "fit", label: "Fit" },
  { key: "valor", label: "Valor estimado" },
  { key: "encerramento", label: "Encerramento" },
] as const;

export type ColumnKey = (typeof TOGGLEABLE_COLUMNS)[number]["key"];

type ColumnVisibility = Record<ColumnKey, boolean>;

const ALL_VISIBLE: ColumnVisibility = {
  modalidade: true,
  status: true,
  fit: true,
  valor: true,
  encerramento: true,
};

const STORAGE_KEY = "plic.licitacoes.cols";

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
      {/* No `name` on these checkboxes — they never reach the GET payload. */}
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

/**
 * Page header (title + result count + inline search) and the Attio-style
 * toolbar. Everything lives in ONE GET form: the search input, the hidden
 * inputs the MultiSelects keep mounted, categoria and the valor range — so
 * any "Aplicar"/Enter submits the complete filter set and the URL contract
 * (`q`, `portal[]`, `modalidade[]`, `status[]`, `categoria`, `setor[]`,
 * `uf[]`, `valorMin`, `valorMax`, `fit[]`) is unchanged.
 */
export function Filters({
  filters,
  facetCounts,
  total,
  showCompat,
}: FiltersProps) {
  const activeCount = countActiveFilters(filters);

  return (
    <form method="GET" action="/licitacoes" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="font-display text-[30px] leading-[34px] text-ink">
            Licitações
          </h1>
          <span className="text-[13px] tabular-nums text-ink-muted">
            {total.toLocaleString("pt-BR")} resultados
          </span>
        </div>
        {/* Same look as the kit's `SearchBox size="inline"`, inlined because
            that component renders its own <form> and forms cannot nest. */}
        <div className="flex h-[34px] w-full max-w-full items-center gap-2 rounded-md border border-line bg-surface px-3.5 text-[13px] text-ink focus-within:border-accent focus-within:ring-[3px] focus-within:ring-accent-soft sm:max-w-xs">
          <Search size={16} className="shrink-0 text-ink-faint" />
          <input
            name="q"
            defaultValue={filters.q ?? ""}
            placeholder="Buscar por objeto, órgão…"
            className="w-full bg-transparent outline-none placeholder:text-ink-faint"
          />
        </div>
      </div>

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
                name="status"
                label="Status"
                options={facetCounts.status}
                selected={filters.statuses ?? []}
              />
              <MultiSelect
                name="modalidade"
                label="Modalidade"
                options={facetCounts.modalidade}
                selected={filters.modalidadeIds?.map(String) ?? []}
              />
              <MultiSelect
                name="setor"
                label="Setor"
                options={facetCounts.setor}
                selected={filters.setores ?? []}
              />
              <MultiSelect
                name="uf"
                label="UF"
                options={facetCounts.uf}
                selected={filters.ufs ?? []}
              />
              <MultiSelect
                name="portal"
                label="Portal"
                options={facetCounts.portal}
                selected={filters.portais ?? []}
              />
              <MultiSelect
                name="fit"
                label="Fit"
                options={FIT_OPTIONS}
                selected={filters.fit ?? []}
              />

              {showCompat && (
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-ink-muted">
                    Empresa
                  </span>
                  <label className="flex cursor-pointer items-center gap-2 text-[13px] text-ink">
                    <input
                      type="checkbox"
                      name="compat"
                      value="1"
                      defaultChecked={filters.compat === true}
                      className="h-3.5 w-3.5 rounded-[4px] accent-accent focus:outline-none focus-visible:ring-[3px] focus-visible:ring-accent-soft"
                    />
                    Compatível com minha empresa
                  </label>
                </div>
              )}

              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-ink-muted">
                  Categoria
                </span>
                <Select
                  name="categoria"
                  defaultValue={filters.categoria ?? ""}
                  className="max-w-none"
                >
                  <option value="">Todas</option>
                  <option value="produto">Produto</option>
                  <option value="servico">Serviço</option>
                  <option value="mista">Mista</option>
                </Select>
              </div>

              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-ink-muted">
                  Valor estimado (R$)
                </span>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    name="valorMin"
                    defaultValue={filters.valorMin ?? ""}
                    placeholder="mín"
                  />
                  <span aria-hidden="true" className="text-ink-faint">
                    –
                  </span>
                  <Input
                    type="number"
                    name="valorMax"
                    defaultValue={filters.valorMax ?? ""}
                    placeholder="máx"
                  />
                </div>
              </div>
            </div>

            <div className="mt-4 flex items-center justify-between border-t border-line pt-3">
              <Link
                href="/licitacoes"
                className="text-[13px] font-medium text-ink-muted hover:text-ink"
              >
                Limpar filtros
              </Link>
              <Button type="submit" size="sm">
                Aplicar
              </Button>
            </div>
          </div>
        </Popover>

        <ToolbarButton
          icon={<Sort />}
          label="Ordenar"
          disabled
          title="em breve"
          className="cursor-not-allowed"
        />

        <ColumnsMenu />
      </Toolbar>
    </form>
  );
}
