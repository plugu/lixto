"use client";

// Chip row above the composer. Purely additive accelerators for the
// natural-language query (PRODUCT.md: "quick controls are accelerators") —
// sending with every chip cleared works exactly like sending with none.

import { Popover } from "@/components/ui/popover";
import { X } from "@/components/ui/icons";
import { STATUS_LABELS, type ProcurementStatus } from "@/lib/status";
import { UF_LIST } from "@/lib/types";

export type QuickFilterValues = {
  states?: string[];
  statuses?: string[];
  valueMin?: number;
  valueMax?: number;
};

const STATUS_OPTIONS: ProcurementStatus[] = ["open", "upcoming"];

function chipClass(active: boolean) {
  return `inline-flex h-7 shrink-0 items-center gap-1 rounded-[9999px] px-3 text-[13px] font-medium transition-colors ${
    active
      ? "bg-accent-soft text-accent"
      : "bg-surface-raised text-ink-muted hover:text-ink"
  }`;
}

function statusLabel(value: string): string {
  return STATUS_LABELS[value as ProcurementStatus] ?? value;
}

function toNumberOrUndefined(raw: string): number | undefined {
  if (raw.trim() === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

export function QuickFilters({
  filters,
  onChange,
}: {
  filters: QuickFilterValues;
  onChange: (next: QuickFilterValues) => void;
}) {
  const states = filters.states ?? [];
  const statuses = filters.statuses ?? [];
  const hasValue =
    filters.valueMin !== undefined || filters.valueMax !== undefined;

  function toggleState(state: string) {
    const next = states.includes(state)
      ? states.filter((v) => v !== state)
      : [...states, state];
    onChange({ ...filters, states: next.length ? next : undefined });
  }

  function toggleStatus(status: string) {
    const next = statuses.includes(status)
      ? statuses.filter((v) => v !== status)
      : [...statuses, status];
    onChange({ ...filters, statuses: next.length ? next : undefined });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Popover
        trigger={
          <span className={chipClass(states.length > 0)}>
            UF{states.length ? ` · ${states.length}` : ""}
          </span>
        }
      >
        <div className="flex max-h-48 w-40 flex-col gap-0.5 overflow-y-auto">
          {UF_LIST.map((state) => (
            <label
              key={state}
              className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-[13px] text-ink hover:bg-surface-raised"
            >
              <input
                type="checkbox"
                checked={states.includes(state)}
                onChange={() => toggleState(state)}
                className="h-3.5 w-3.5 rounded-[4px] border-line text-accent accent-accent focus-visible:ring-[3px] focus-visible:ring-accent-soft"
              />
              {state}
            </label>
          ))}
        </div>
      </Popover>

      {STATUS_OPTIONS.map((status) => (
        <button
          key={status}
          type="button"
          onClick={() => toggleStatus(status)}
          className={chipClass(statuses.includes(status))}
        >
          {STATUS_LABELS[status]}
        </button>
      ))}

      <div className="flex items-center gap-1.5">
        <input
          type="number"
          inputMode="numeric"
          placeholder="Mín. R$"
          value={filters.valueMin ?? ""}
          onChange={(e) =>
            onChange({ ...filters, valueMin: toNumberOrUndefined(e.target.value) })
          }
          className="h-7 w-24 rounded-[9999px] border border-line bg-surface px-3 text-[13px] text-ink outline-none placeholder:text-ink-faint focus-visible:border-accent focus-visible:ring-[3px] focus-visible:ring-accent-soft"
        />
        <span className="text-ink-faint">–</span>
        <input
          type="number"
          inputMode="numeric"
          placeholder="Máx. R$"
          value={filters.valueMax ?? ""}
          onChange={(e) =>
            onChange({ ...filters, valueMax: toNumberOrUndefined(e.target.value) })
          }
          className="h-7 w-24 rounded-[9999px] border border-line bg-surface px-3 text-[13px] text-ink outline-none placeholder:text-ink-faint focus-visible:border-accent focus-visible:ring-[3px] focus-visible:ring-accent-soft"
        />
      </div>

      {states.length > 0 ? (
        <ActiveChip
          label={`UF: ${states.join(", ")}`}
          onClear={() => onChange({ ...filters, states: undefined })}
        />
      ) : null}
      {statuses.length > 0 ? (
        <ActiveChip
          label={`Status: ${statuses.map(statusLabel).join(", ")}`}
          onClear={() => onChange({ ...filters, statuses: undefined })}
        />
      ) : null}
      {hasValue ? (
        <ActiveChip
          label={`Valor: ${filters.valueMin ?? "0"}–${filters.valueMax ?? "∞"}`}
          onClear={() =>
            onChange({ ...filters, valueMin: undefined, valueMax: undefined })
          }
        />
      ) : null}
    </div>
  );
}

function ActiveChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-[9999px] bg-accent-soft px-3 text-[13px] font-medium text-accent">
      {label}
      <button
        type="button"
        onClick={onClear}
        aria-label={`Remover filtro: ${label}`}
        className="text-accent/70 hover:text-accent"
      >
        <X size={12} />
      </button>
    </span>
  );
}
