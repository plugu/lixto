"use client";

import type { ModalidadeOption } from "@/lib/queries";
import { STATUS_LABELS } from "@/lib/status";

type FiltersProps = {
  q: string;
  portal: string;
  modalidadeId: string;
  status: string;
  portalOptions: string[];
  modalidadeOptions: ModalidadeOption[];
  hasActiveFilters: boolean;
};

const CONTROL_CLASS =
  "rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-foreground shadow-subtle focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40";

export function Filters({
  q,
  portal,
  modalidadeId,
  status,
  portalOptions,
  modalidadeOptions,
  hasActiveFilters,
}: FiltersProps) {
  return (
    <form
      method="GET"
      action="/licitacoes"
      className="flex flex-wrap items-center gap-2"
    >
      <input
        type="text"
        name="q"
        defaultValue={q}
        placeholder="Palavra-chave"
        className={`min-w-[200px] flex-1 ${CONTROL_CLASS} placeholder:text-muted-foreground/60`}
      />

      <select
        name="portal"
        defaultValue={portal}
        className={`max-w-56 ${CONTROL_CLASS}`}
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
      >
        <option value="">Portal: Todos</option>
        {portalOptions.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>

      <select
        name="modalidade"
        defaultValue={modalidadeId}
        className={CONTROL_CLASS}
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
      >
        <option value="">Modalidade: Todos</option>
        {modalidadeOptions.map((option) => (
          <option key={option.id} value={option.id}>
            {option.nome}
          </option>
        ))}
      </select>

      <select
        name="status"
        defaultValue={status}
        className={CONTROL_CLASS}
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
      >
        <option value="">Status: Todos</option>
        <option value="aberta">{STATUS_LABELS.aberta}</option>
        <option value="vai_abrir">{STATUS_LABELS.vai_abrir}</option>
        <option value="fechada">{STATUS_LABELS.fechada}</option>
      </select>

      <button
        type="submit"
        className="rounded-lg bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground shadow-sm transition-all duration-150 hover:bg-primary/90 hover:shadow active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        Buscar
      </button>

      {hasActiveFilters && (
        <a href="/licitacoes" className="text-sm text-accent hover:underline">
          Limpar filtros
        </a>
      )}
    </form>
  );
}
