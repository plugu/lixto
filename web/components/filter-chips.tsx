import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { X } from "@/components/ui/icons";
import type {
  ModalityOption,
  ProcurementFilters,
  ProcurementKind,
} from "@/lib/procurement-queries";
import { STATUS_LABELS } from "@/lib/status";

type RawSearchParams = Record<string, string | string[] | undefined>;

type Chip = { key: string; label: string; href: string };

const KIND_LABELS: Record<ProcurementKind, string> = {
  product: "Produto",
  service: "Serviço",
  mixed: "Misto",
};

function formatValue(value: number): string {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(value);
}

function toURLSearchParams(raw: RawSearchParams): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      value.forEach((v) => params.append(key, v));
    } else {
      params.append(key, value);
    }
  }
  return params;
}

/** Rebuilds the current search params minus one value from one field (the
 * whole field, when `value` is omitted) — used to build each chip's "remove
 * this selection" link. Also drops `page` so removing a filter resets to
 * page 1. */
function withoutValue(
  searchParams: URLSearchParams,
  field: string,
  value?: string,
): URLSearchParams {
  const next = new URLSearchParams(searchParams);
  next.delete("page");
  if (value === undefined) {
    next.delete(field);
    return next;
  }
  const remaining = next.getAll(field).filter((v) => v !== value);
  next.delete(field);
  remaining.forEach((v) => next.append(field, v));
  return next;
}

function buildHref(params: URLSearchParams): string {
  const qs = params.toString();
  return qs ? `/procurements?${qs}` : "/procurements";
}

export function FilterChips({
  filters,
  searchParams,
  modalityOptions,
}: {
  filters: ProcurementFilters;
  searchParams: RawSearchParams;
  modalityOptions: ModalityOption[];
}) {
  const params = toURLSearchParams(searchParams);
  const chips: Chip[] = [];

  if (filters.q) {
    chips.push({
      key: "q",
      label: `"${filters.q}"`,
      href: buildHref(withoutValue(params, "q")),
    });
  }

  filters.modalityIds?.forEach((id) => {
    const name = modalityOptions.find((m) => m.id === id)?.name ?? String(id);
    chips.push({
      key: `modality-${id}`,
      label: name,
      href: buildHref(withoutValue(params, "modality", String(id))),
    });
  });

  filters.categories?.forEach((category) => {
    chips.push({
      key: `category-${category}`,
      label: category,
      href: buildHref(withoutValue(params, "category", category)),
    });
  });

  filters.portals?.forEach((portal) => {
    chips.push({
      key: `portal-${portal}`,
      label: portal,
      href: buildHref(withoutValue(params, "portal", portal)),
    });
  });

  filters.statuses?.forEach((status) => {
    chips.push({
      key: `status-${status}`,
      label: STATUS_LABELS[status],
      href: buildHref(withoutValue(params, "status", status)),
    });
  });

  filters.states?.forEach((state) => {
    chips.push({
      key: `state-${state}`,
      label: state,
      href: buildHref(withoutValue(params, "state", state)),
    });
  });

  if (filters.compat) {
    chips.push({
      key: "compat",
      label: "Compatível com minha empresa",
      href: buildHref(withoutValue(params, "compat")),
    });
  }

  if (filters.kind) {
    chips.push({
      key: "kind",
      label: KIND_LABELS[filters.kind],
      href: buildHref(withoutValue(params, "kind")),
    });
  }

  if (filters.valueMin !== undefined || filters.valueMax !== undefined) {
    const min = filters.valueMin !== undefined ? formatValue(filters.valueMin) : undefined;
    const max = filters.valueMax !== undefined ? formatValue(filters.valueMax) : undefined;
    const label =
      min !== undefined && max !== undefined
        ? `R$ ${min}–${max}`
        : min !== undefined
          ? `R$ ≥ ${min}`
          : `R$ ≤ ${max}`;
    chips.push({
      key: "value",
      label,
      href: buildHref(withoutValue(withoutValue(params, "valueMin"), "valueMax")),
    });
  }

  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {chips.map((chip) => (
        <Link
          key={chip.key}
          href={chip.href}
          title={`Remover ${chip.label}`}
          className="rounded-[9999px] transition-opacity hover:opacity-70 focus:outline-none focus-visible:ring-[3px] focus-visible:ring-accent-soft"
        >
          <Badge tone="neutral">
            {chip.label}
            <X size={12} />
          </Badge>
        </Link>
      ))}
      <Link
        href="/procurements"
        className="text-[13px] font-medium text-ink-muted hover:text-ink focus:outline-none focus-visible:ring-[3px] focus-visible:ring-accent-soft"
      >
        Limpar tudo
      </Link>
    </div>
  );
}
