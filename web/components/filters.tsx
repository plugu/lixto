"use client";

import { MultiSelect } from "@/components/multi-select";
import type { FacetCounts, LicitacaoFilters } from "@/lib/queries";

type FiltersProps = {
  filters: LicitacaoFilters;
  facetCounts: FacetCounts;
};

const CONTROL_CLASS =
  "rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-foreground shadow-subtle focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40";

export function Filters({ filters, facetCounts }: FiltersProps) {
  return (
    <form
      method="GET"
      action="/licitacoes"
      className="space-y-3 rounded-lg border border-border bg-card p-3 shadow-subtle"
    >
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          name="q"
          defaultValue={filters.q ?? ""}
          placeholder="Palavra-chave"
          className={`min-w-[200px] flex-1 ${CONTROL_CLASS} placeholder:text-muted-foreground/60`}
        />
        <input
          type="number"
          name="valorMin"
          defaultValue={filters.valorMin ?? ""}
          placeholder="Valor mín"
          className={`w-32 ${CONTROL_CLASS} placeholder:text-muted-foreground/60`}
        />
        <span aria-hidden="true" className="text-muted-foreground">
          –
        </span>
        <input
          type="number"
          name="valorMax"
          defaultValue={filters.valorMax ?? ""}
          placeholder="Valor máx"
          className={`w-32 ${CONTROL_CLASS} placeholder:text-muted-foreground/60`}
        />
        <button
          type="submit"
          className="rounded-lg bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground shadow-sm transition-all duration-150 hover:bg-primary/90 hover:shadow active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          Buscar
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
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

        <select
          name="categoria"
          defaultValue={filters.categoria ?? ""}
          className={`max-w-56 ${CONTROL_CLASS}`}
          onChange={(event) => event.currentTarget.form?.requestSubmit()}
        >
          <option value="">Categoria: Todas</option>
          <option value="produto">Produto</option>
          <option value="servico">Serviço</option>
          <option value="mista">Mista</option>
        </select>
      </div>
    </form>
  );
}
