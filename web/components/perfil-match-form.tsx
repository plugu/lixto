"use client";

// Perfil de match form (ticket 65): admins edit + save every field; members
// see the same layout with everything disabled and no save button — same
// read-only behaviour as EmpresaForm.

import { useActionState, useState } from "react";
import { UF_LIST } from "@/lib/tenant-types";
import type { PerfilMatch } from "@/lib/perfil-queries";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Section } from "@/components/ui/section";
import {
  updatePerfilAction,
  type PerfilActionState,
} from "@/app/(app)/empresa/perfil/actions";

const INITIAL_STATE: PerfilActionState = {};

const TEXTAREA_CLASS =
  "min-h-24 w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint outline-none transition-colors focus-visible:border-accent focus-visible:ring-[3px] focus-visible:ring-accent-soft disabled:opacity-50";

function Textarea({
  name,
  defaultValue,
  disabled,
  placeholder,
}: {
  name: string;
  defaultValue: string;
  disabled: boolean;
  placeholder?: string;
}) {
  return (
    <textarea
      name={name}
      defaultValue={defaultValue}
      disabled={disabled}
      placeholder={placeholder}
      className={TEXTAREA_CLASS}
    />
  );
}

export function PerfilMatchForm({
  perfil,
  readOnly,
}: {
  perfil: PerfilMatch | null;
  readOnly: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    updatePerfilAction,
    INITIAL_STATE,
  );
  const [selectedUfs, setSelectedUfs] = useState<string[]>(perfil?.ufs ?? []);

  function toggleUf(uf: string) {
    setSelectedUfs((prev) =>
      prev.includes(uf) ? prev.filter((u) => u !== uf) : [...prev, uf],
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-10 pb-24">
      {state.erro ? (
        <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
          {state.erro}
        </p>
      ) : null}
      {state.ok ? (
        <p role="status" className="rounded-md bg-ok-soft px-3 py-2 text-sm text-ok">
          Alterações salvas.
        </p>
      ) : null}

      <Section title="Produtos e serviços">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Field label="Produtos" hint="Um por linha.">
            <Textarea
              name="produtos"
              defaultValue={(perfil?.produtos ?? []).join("\n")}
              disabled={readOnly}
            />
          </Field>
          <Field label="Palavras-chave" hint="Um por linha.">
            <Textarea
              name="palavrasChave"
              defaultValue={(perfil?.palavras_chave ?? []).join("\n")}
              disabled={readOnly}
            />
          </Field>
        </div>
        <Field label="Exclusões" hint="Um por linha. Licitações com esses termos são descartadas.">
          <Textarea
            name="exclusoes"
            defaultValue={(perfil?.exclusoes ?? []).join("\n")}
            disabled={readOnly}
          />
        </Field>
      </Section>

      <Section title="Abrangência">
        <Field label="UFs" hint="Nenhuma marcada = todas.">
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-9">
            {UF_LIST.map((uf) => (
              <label
                key={uf}
                className="flex items-center gap-1.5 text-sm text-ink"
              >
                <input
                  type="checkbox"
                  name="ufs"
                  value={uf}
                  checked={selectedUfs.includes(uf)}
                  onChange={() => toggleUf(uf)}
                  disabled={readOnly}
                  className="h-4 w-4 rounded-[6px] border border-line accent-accent disabled:opacity-50"
                />
                {uf}
              </label>
            ))}
          </div>
        </Field>
      </Section>

      <Section title="Faixa de valor">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Field label="Valor mínimo">
            <Input
              type="text"
              name="valorMin"
              defaultValue={perfil?.valor_min ?? ""}
              disabled={readOnly}
              placeholder="R$ 0,00"
            />
          </Field>
          <Field label="Valor máximo">
            <Input
              type="text"
              name="valorMax"
              defaultValue={perfil?.valor_max ?? ""}
              disabled={readOnly}
              placeholder="R$ 0,00"
            />
          </Field>
        </div>
      </Section>

      <Section title="Observações">
        <Field label="Observações">
          <Textarea
            name="observacoes"
            defaultValue={perfil?.observacoes ?? ""}
            disabled={readOnly}
          />
        </Field>
      </Section>

      {!readOnly ? (
        <div className="sticky bottom-0 z-10 flex items-center justify-end border-t border-line bg-canvas py-4">
          <Button type="submit" disabled={pending}>
            {pending ? "Salvando…" : "Salvar"}
          </Button>
        </div>
      ) : null}
    </form>
  );
}
