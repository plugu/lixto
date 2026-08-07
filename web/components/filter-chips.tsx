import Link from "next/link";
import type { CategoriaLicitacao, LicitacaoFilters, ModalidadeOption } from "@/lib/queries";
import { STATUS_LABELS } from "@/lib/status";

type RawSearchParams = Record<string, string | string[] | undefined>;

type Chip = { key: string; label: string; href: string };

const CATEGORIA_LABELS: Record<CategoriaLicitacao, string> = {
  produto: "Produto",
  servico: "Serviço",
  mista: "Mista",
};

const CHIP_CLASS =
  "inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-3 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40";

function formatValor(value: number): string {
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
 * this selection" link. Also drops `pagina` so removing a filter resets to
 * page 1. */
function withoutValue(
  searchParams: URLSearchParams,
  field: string,
  value?: string,
): URLSearchParams {
  const next = new URLSearchParams(searchParams);
  next.delete("pagina");
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
  return qs ? `/licitacoes?${qs}` : "/licitacoes";
}

export function FilterChips({
  filters,
  searchParams,
  modalidadeOptions,
}: {
  filters: LicitacaoFilters;
  searchParams: RawSearchParams;
  modalidadeOptions: ModalidadeOption[];
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

  filters.modalidadeIds?.forEach((id) => {
    const nome = modalidadeOptions.find((m) => m.id === id)?.nome ?? String(id);
    chips.push({
      key: `modalidade-${id}`,
      label: nome,
      href: buildHref(withoutValue(params, "modalidade", String(id))),
    });
  });

  filters.setores?.forEach((setor) => {
    chips.push({
      key: `setor-${setor}`,
      label: setor,
      href: buildHref(withoutValue(params, "setor", setor)),
    });
  });

  filters.portais?.forEach((portal) => {
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

  filters.ufs?.forEach((uf) => {
    chips.push({
      key: `uf-${uf}`,
      label: uf,
      href: buildHref(withoutValue(params, "uf", uf)),
    });
  });

  if (filters.categoria) {
    chips.push({
      key: "categoria",
      label: CATEGORIA_LABELS[filters.categoria],
      href: buildHref(withoutValue(params, "categoria")),
    });
  }

  if (filters.valorMin !== undefined || filters.valorMax !== undefined) {
    const min = filters.valorMin !== undefined ? formatValor(filters.valorMin) : undefined;
    const max = filters.valorMax !== undefined ? formatValor(filters.valorMax) : undefined;
    const label =
      min !== undefined && max !== undefined
        ? `R$ ${min}–${max}`
        : min !== undefined
          ? `R$ ≥ ${min}`
          : `R$ ≤ ${max}`;
    chips.push({
      key: "valor",
      label,
      href: buildHref(withoutValue(withoutValue(params, "valorMin"), "valorMax")),
    });
  }

  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {chips.map((chip) => (
        <Link key={chip.key} href={chip.href} className={CHIP_CLASS}>
          {chip.label}
          <span aria-hidden="true">×</span>
        </Link>
      ))}
      <Link
        href="/licitacoes"
        className="text-xs font-medium text-accent hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        Limpar tudo
      </Link>
    </div>
  );
}
