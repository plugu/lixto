"use client";

// Controlled list editor for empresa_cnae rows (ticket 26). Serializes into a
// single hidden `cnaes` input (JSON) so the server action gets one field —
// the form itself has no native multi-row input support.

import { useState } from "react";
import { onlyDigits } from "@/lib/br-validators";

export type CnaeRow = {
  codigo: string;
  descricao: string;
  principal: boolean;
};

const INPUT_CLASS =
  "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm shadow-subtle outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-60 disabled:cursor-not-allowed";

/** Masks digits as `0000-0/00` (7-digit CNAE code) as the user types. */
function maskCodigo(value: string): string {
  const digits = onlyDigits(value).slice(0, 7);
  let out = digits.slice(0, 4);
  if (digits.length > 4) out += "-" + digits.slice(4, 5);
  if (digits.length > 5) out += "/" + digits.slice(5, 7);
  return out;
}

export function CnaeEditor({
  initialCnaes,
  readOnly,
}: {
  initialCnaes: CnaeRow[];
  readOnly: boolean;
}) {
  const [rows, setRows] = useState<CnaeRow[]>(initialCnaes);

  function updateRow(index: number, patch: Partial<CnaeRow>) {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function setPrincipal(index: number) {
    setRows((prev) => prev.map((row, i) => ({ ...row, principal: i === index })));
  }

  function removeRow(index: number) {
    setRows((prev) => prev.filter((_, i) => i !== index));
  }

  function addRow() {
    setRows((prev) => [...prev, { codigo: "", descricao: "", principal: prev.length === 0 }]);
  }

  return (
    <div className="flex flex-col gap-3">
      <input type="hidden" name="cnaes" value={JSON.stringify(rows)} />

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum CNAE cadastrado.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((row, index) => (
            <div
              key={index}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3 shadow-subtle"
            >
              <input
                type="text"
                value={maskCodigo(row.codigo)}
                onChange={(e) => updateRow(index, { codigo: onlyDigits(e.target.value) })}
                placeholder="0000-0/00"
                disabled={readOnly}
                className={`${INPUT_CLASS} max-w-32`}
              />
              <input
                type="text"
                value={row.descricao}
                onChange={(e) => updateRow(index, { descricao: e.target.value })}
                placeholder="Descrição"
                disabled={readOnly}
                className={`${INPUT_CLASS} min-w-0 flex-1`}
              />
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <input
                  type="radio"
                  name="cnae-principal"
                  checked={row.principal}
                  onChange={() => setPrincipal(index)}
                  disabled={readOnly}
                />
                Principal
              </label>
              {!readOnly ? (
                <button
                  type="button"
                  onClick={() => removeRow(index)}
                  className="text-xs font-medium text-unclear hover:underline"
                >
                  Remover
                </button>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {!readOnly ? (
        <button
          type="button"
          onClick={addRow}
          className="self-start rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium shadow-subtle hover:bg-muted/30"
        >
          Adicionar CNAE
        </button>
      ) : null}
    </div>
  );
}
