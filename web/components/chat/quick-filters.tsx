"use client";

// Chip row above the composer (ticket 69). Purely additive accelerators for
// the natural-language query (PRODUCT.md: "quick controls are accelerators")
// — sending with every chip cleared works exactly like sending with none.

import { Popover } from "@/components/ui/popover";
import { X } from "@/components/ui/icons";
import { UF_LIST } from "@/lib/tenant-types";

export type QuickFiltros = {
  ufs?: string[];
  statuses?: string[];
  valorMin?: number;
  valorMax?: number;
};

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "aberta", label: "Aberta" },
  { value: "vai_abrir", label: "Vai abrir" },
];

function chipClass(active: boolean) {
  return `inline-flex h-7 shrink-0 items-center gap-1 rounded-[9999px] px-3 text-[13px] font-medium transition-colors ${
    active
      ? "bg-accent-soft text-accent"
      : "bg-surface-raised text-ink-muted hover:text-ink"
  }`;
}

function statusLabel(value: string): string {
  return STATUS_OPTIONS.find((o) => o.value === value)?.label ?? value;
}

function toNumberOrUndefined(raw: string): number | undefined {
  if (raw.trim() === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

export function QuickFilters({
  filtros,
  onChange,
}: {
  filtros: QuickFiltros;
  onChange: (next: QuickFiltros) => void;
}) {
  const ufs = filtros.ufs ?? [];
  const statuses = filtros.statuses ?? [];
  const temValor = filtros.valorMin !== undefined || filtros.valorMax !== undefined;

  function toggleUf(uf: string) {
    const next = ufs.includes(uf) ? ufs.filter((v) => v !== uf) : [...ufs, uf];
    onChange({ ...filtros, ufs: next.length ? next : undefined });
  }

  function toggleStatus(status: string) {
    const next = statuses.includes(status)
      ? statuses.filter((v) => v !== status)
      : [...statuses, status];
    onChange({ ...filtros, statuses: next.length ? next : undefined });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Popover
        trigger={
          <span className={chipClass(ufs.length > 0)}>
            UF{ufs.length ? ` · ${ufs.length}` : ""}
          </span>
        }
      >
        <div className="flex max-h-48 w-40 flex-col gap-0.5 overflow-y-auto">
          {UF_LIST.map((uf) => (
            <label
              key={uf}
              className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-[13px] text-ink hover:bg-surface-raised"
            >
              <input
                type="checkbox"
                checked={ufs.includes(uf)}
                onChange={() => toggleUf(uf)}
                className="h-3.5 w-3.5 rounded-[4px] border-line text-accent accent-accent focus-visible:ring-[3px] focus-visible:ring-accent-soft"
              />
              {uf}
            </label>
          ))}
        </div>
      </Popover>

      {STATUS_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => toggleStatus(option.value)}
          className={chipClass(statuses.includes(option.value))}
        >
          {option.label}
        </button>
      ))}

      <div className="flex items-center gap-1.5">
        <input
          type="number"
          inputMode="numeric"
          placeholder="Mín. R$"
          value={filtros.valorMin ?? ""}
          onChange={(e) =>
            onChange({ ...filtros, valorMin: toNumberOrUndefined(e.target.value) })
          }
          className="h-7 w-24 rounded-[9999px] border border-line bg-surface px-3 text-[13px] text-ink outline-none placeholder:text-ink-faint focus-visible:border-accent focus-visible:ring-[3px] focus-visible:ring-accent-soft"
        />
        <span className="text-ink-faint">–</span>
        <input
          type="number"
          inputMode="numeric"
          placeholder="Máx. R$"
          value={filtros.valorMax ?? ""}
          onChange={(e) =>
            onChange({ ...filtros, valorMax: toNumberOrUndefined(e.target.value) })
          }
          className="h-7 w-24 rounded-[9999px] border border-line bg-surface px-3 text-[13px] text-ink outline-none placeholder:text-ink-faint focus-visible:border-accent focus-visible:ring-[3px] focus-visible:ring-accent-soft"
        />
      </div>

      {ufs.length > 0 ? (
        <ActiveChip
          label={`UF: ${ufs.join(", ")}`}
          onClear={() => onChange({ ...filtros, ufs: undefined })}
        />
      ) : null}
      {statuses.length > 0 ? (
        <ActiveChip
          label={`Status: ${statuses.map(statusLabel).join(", ")}`}
          onClear={() => onChange({ ...filtros, statuses: undefined })}
        />
      ) : null}
      {temValor ? (
        <ActiveChip
          label={`Valor: ${filtros.valorMin ?? "0"}–${filtros.valorMax ?? "∞"}`}
          onClear={() => onChange({ ...filtros, valorMin: undefined, valorMax: undefined })}
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
