"use client";

import { applyCompatGate } from "@/components/filters";
import { Badge } from "@/components/ui/badge";
import { X } from "@/components/ui/icons";
import type {
  ModalityOption,
  ProcurementFilters,
  ProcurementKind,
} from "@/lib/procurement-queries";
import { useProcurementFilters } from "@/lib/procurement-url";
import { STATUS_LABELS } from "@/lib/status";

type Chip = { key: string; label: string; remove: ProcurementFilters };

const KIND_LABELS: Record<ProcurementKind, string> = {
  product: "Produto",
  service: "Serviço",
  mixed: "Misto",
};

function formatValue(value: number): string {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(value);
}

function orUndefined<T>(values: T[]): T[] | undefined {
  return values.length > 0 ? values : undefined;
}

/**
 * Removable chips for the active filters. Each chip is a button that writes
 * the reduced filter set through `useProcurementFilters()` — no href
 * rebuilding, no document reload, and `page` resets because that hook always
 * drops it on a filter change.
 */
export function FilterChips({
  modalityOptions,
  showCompat,
}: {
  modalityOptions: ModalityOption[];
  showCompat?: boolean;
}) {
  const { filters, pending, setFilters } = useProcurementFilters();
  const active = applyCompatGate(filters, showCompat);
  const chips: Chip[] = [];

  if (active.q) {
    chips.push({ key: "q", label: `"${active.q}"`, remove: { ...active, q: undefined } });
  }

  active.modalityIds?.forEach((id) => {
    const name = modalityOptions.find((m) => m.id === id)?.name ?? String(id);
    chips.push({
      key: `modality-${id}`,
      label: name,
      remove: {
        ...active,
        modalityIds: orUndefined(
          (active.modalityIds ?? []).filter((v) => v !== id),
        ),
      },
    });
  });

  active.categories?.forEach((category) => {
    chips.push({
      key: `category-${category}`,
      label: category,
      remove: {
        ...active,
        categories: orUndefined(
          (active.categories ?? []).filter((v) => v !== category),
        ),
      },
    });
  });

  active.portals?.forEach((portal) => {
    chips.push({
      key: `portal-${portal}`,
      label: portal,
      remove: {
        ...active,
        portals: orUndefined((active.portals ?? []).filter((v) => v !== portal)),
      },
    });
  });

  active.statuses?.forEach((status) => {
    chips.push({
      key: `status-${status}`,
      label: STATUS_LABELS[status],
      remove: {
        ...active,
        statuses: orUndefined(
          (active.statuses ?? []).filter((v) => v !== status),
        ),
      },
    });
  });

  active.states?.forEach((state) => {
    chips.push({
      key: `state-${state}`,
      label: state,
      remove: {
        ...active,
        states: orUndefined((active.states ?? []).filter((v) => v !== state)),
      },
    });
  });

  if (active.compat) {
    chips.push({
      key: "compat",
      label: "Compatível com minha empresa",
      remove: { ...active, compat: undefined },
    });
  }

  if (active.kind) {
    chips.push({
      key: "kind",
      label: KIND_LABELS[active.kind],
      remove: { ...active, kind: undefined },
    });
  }

  if (active.valueMin !== undefined || active.valueMax !== undefined) {
    const min =
      active.valueMin !== undefined ? formatValue(active.valueMin) : undefined;
    const max =
      active.valueMax !== undefined ? formatValue(active.valueMax) : undefined;
    const label =
      min !== undefined && max !== undefined
        ? `R$ ${min}–${max}`
        : min !== undefined
          ? `R$ ≥ ${min}`
          : `R$ ≤ ${max}`;
    chips.push({
      key: "value",
      label,
      remove: { ...active, valueMin: undefined, valueMax: undefined },
    });
  }

  if (chips.length === 0) return null;

  return (
    <div
      aria-busy={pending}
      className={`flex flex-wrap items-center gap-2 transition-opacity ${
        pending ? "opacity-60" : ""
      }`}
    >
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          title={`Remover ${chip.label}`}
          onClick={() => setFilters(chip.remove)}
          className="rounded-[9999px] transition-opacity hover:opacity-70 focus:outline-none focus-visible:ring-[3px] focus-visible:ring-accent-soft"
        >
          <Badge tone="neutral">
            {chip.label}
            <X size={12} />
          </Badge>
        </button>
      ))}
      <button
        type="button"
        onClick={() => setFilters({})}
        className="text-[13px] font-medium text-ink-muted hover:text-ink focus:outline-none focus-visible:ring-[3px] focus-visible:ring-accent-soft"
      >
        Limpar tudo
      </button>
    </div>
  );
}
