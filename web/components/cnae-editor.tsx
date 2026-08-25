"use client";

// Controlled list editor for company_cnaes rows. Serializes into a
// single hidden `cnaes` input (JSON) so the server action gets one field —
// the form itself has no native multi-row input support. Restyled on the
// cycle 8 kit (ticket 36) as a hairline list with a `Badge` marking the
// principal row; the serialized `cnaes` field shape is unchanged.

import { useState } from "react";
import { onlyDigits } from "@/lib/br-validators";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, X } from "@/components/ui/icons";

export type CnaeRow = {
  code: string;
  description: string;
  isPrimary: boolean;
};

/** Masks digits as `0000-0/00` (7-digit CNAE code) as the user types. */
function maskCode(value: string): string {
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

  function setPrimary(index: number) {
    setRows((prev) => prev.map((row, i) => ({ ...row, isPrimary: i === index })));
  }

  function removeRow(index: number) {
    setRows((prev) => prev.filter((_, i) => i !== index));
  }

  function addRow() {
    setRows((prev) => [...prev, { code: "", description: "", isPrimary: prev.length === 0 }]);
  }

  return (
    <div className="flex flex-col gap-3">
      <input type="hidden" name="cnaes" value={JSON.stringify(rows)} />

      {rows.length === 0 ? (
        <p className="text-sm text-ink-muted">Nenhum CNAE cadastrado.</p>
      ) : (
        <div className="flex flex-col divide-y divide-line border-t border-b border-line">
          {rows.map((row, index) => (
            <div
              key={index}
              className="flex flex-col gap-2 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3"
            >
              <Input
                type="text"
                value={maskCode(row.code)}
                onChange={(e) => updateRow(index, { code: onlyDigits(e.target.value) })}
                placeholder="0000-0/00"
                disabled={readOnly}
                className="sm:max-w-32"
              />
              <Input
                type="text"
                value={row.description}
                onChange={(e) => updateRow(index, { description: e.target.value })}
                placeholder="Descrição"
                disabled={readOnly}
                className="min-w-0 sm:flex-1"
              />
              <div className="flex items-center justify-between gap-3 sm:contents">
                {row.isPrimary ? (
                  <Badge tone="accent">Principal</Badge>
                ) : !readOnly ? (
                  <button
                    type="button"
                    onClick={() => setPrimary(index)}
                    className="shrink-0 text-xs font-medium text-ink-muted hover:text-ink"
                  >
                    Tornar principal
                  </button>
                ) : null}
                {!readOnly ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeRow(index)}
                    aria-label="Remover CNAE"
                  >
                    <X size={16} />
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}

      {!readOnly ? (
        <Button type="button" variant="secondary" size="sm" onClick={addRow} className="self-start">
          <Plus size={14} />
          Adicionar CNAE
        </Button>
      ) : null}
    </div>
  );
}
