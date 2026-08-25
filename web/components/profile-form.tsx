"use client";

// Match profile form (/company/profile): admins edit + save every field;
// members see the same layout with everything disabled and no save button —
// same read-only behaviour as CompanyForm.

import { useActionState, useState } from "react";
import { UF_LIST } from "@/lib/types";
import type { CompanyProfile } from "@/lib/profile-queries";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Section } from "@/components/ui/section";
import {
  updateProfileAction,
  type ProfileActionState,
} from "@/app/(app)/company/profile/actions";

const INITIAL_STATE: ProfileActionState = {};

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

export function ProfileForm({
  profile,
  readOnly,
}: {
  profile: CompanyProfile | null;
  readOnly: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    updateProfileAction,
    INITIAL_STATE,
  );
  const [selectedStates, setSelectedStates] = useState<string[]>(
    profile?.states ?? [],
  );

  function toggleState(state: string) {
    setSelectedStates((prev) =>
      prev.includes(state) ? prev.filter((s) => s !== state) : [...prev, state],
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-10 pb-24">
      {state.error ? (
        <p
          role="alert"
          className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger"
        >
          {state.error}
        </p>
      ) : null}
      {state.ok ? (
        <p role="status" className="rounded-md bg-ok-soft px-3 py-2 text-sm text-ok">
          {state.warning ?? "Alterações salvas."}
        </p>
      ) : null}

      <Section title="Produtos e serviços">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Field label="Produtos" hint="Um por linha.">
            <Textarea
              name="products"
              defaultValue={(profile?.products ?? []).join("\n")}
              disabled={readOnly}
            />
          </Field>
          <Field label="Palavras-chave" hint="Um por linha.">
            <Textarea
              name="keywords"
              defaultValue={(profile?.keywords ?? []).join("\n")}
              disabled={readOnly}
            />
          </Field>
        </div>
        <Field
          label="Exclusões"
          hint="Um por linha. Licitações com esses termos são descartadas."
        >
          <Textarea
            name="exclusions"
            defaultValue={(profile?.exclusions ?? []).join("\n")}
            disabled={readOnly}
          />
        </Field>
      </Section>

      <Section title="Abrangência">
        <Field label="UFs" hint="Nenhuma marcada = todas.">
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-9">
            {UF_LIST.map((uf) => (
              <label key={uf} className="flex items-center gap-1.5 text-sm text-ink">
                <input
                  type="checkbox"
                  name="states"
                  value={uf}
                  checked={selectedStates.includes(uf)}
                  onChange={() => toggleState(uf)}
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
              name="minValue"
              defaultValue={profile?.min_value ?? ""}
              disabled={readOnly}
              placeholder="R$ 0,00"
            />
          </Field>
          <Field label="Valor máximo">
            <Input
              type="text"
              name="maxValue"
              defaultValue={profile?.max_value ?? ""}
              disabled={readOnly}
              placeholder="R$ 0,00"
            />
          </Field>
        </div>
      </Section>

      <Section title="Observações">
        <Field label="Observações">
          <Textarea
            name="notes"
            defaultValue={profile?.notes ?? ""}
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
