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

const SELECT_CLASS =
  "rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-600";

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
      action="/"
      className="mb-4 flex flex-wrap items-center gap-2"
    >
      <input
        type="text"
        name="q"
        defaultValue={q}
        placeholder="Palavra-chave"
        className="min-w-[200px] flex-1 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-600"
      />

      <select
        name="portal"
        defaultValue={portal}
        className={SELECT_CLASS}
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
        className={SELECT_CLASS}
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
        className={SELECT_CLASS}
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
      >
        <option value="">Status: Todos</option>
        <option value="aberta">{STATUS_LABELS.aberta}</option>
        <option value="vai_abrir">{STATUS_LABELS.vai_abrir}</option>
        <option value="fechada">{STATUS_LABELS.fechada}</option>
      </select>

      <button
        type="submit"
        className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
      >
        Buscar
      </button>

      {hasActiveFilters && (
        <a href="/" className="text-sm text-blue-600 hover:underline">
          Limpar filtros
        </a>
      )}
    </form>
  );
}
