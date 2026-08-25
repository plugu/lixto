"use client";

import { useActionState } from "react";
import { uploadDocumentoAction, type UploadState } from "@/app/(app)/empresa/documentos/actions";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { Section } from "@/components/ui/section";
import { DOCUMENTO_TIPOS } from "@/lib/tenant-types";

const INITIAL_STATE: UploadState = {};

export function DocumentoUploadForm() {
  const [state, formAction, pending] = useActionState(
    uploadDocumentoAction,
    INITIAL_STATE,
  );

  return (
    <Section title="Enviar documento">
      <form
        action={formAction}
        className="flex flex-col gap-4 md:flex-row md:flex-wrap md:items-end"
      >
        <Field label="Tipo">
          <Select name="tipo" required>
            {DOCUMENTO_TIPOS.map((tipo) => (
              <option key={tipo.value} value={tipo.value}>
                {tipo.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Validade (opcional)">
          <Input type="date" name="validade" />
        </Field>

        <Field label="Arquivo">
          <Input type="file" name="arquivo" accept=".pdf,.jpg,.jpeg,.png" required />
        </Field>

        <Button type="submit" disabled={pending} className="w-full md:w-auto">
          {pending ? "Enviando…" : "Enviar"}
        </Button>

        {state.error ? (
          <p role="alert" className="w-full text-sm text-danger">
            {state.error}
          </p>
        ) : null}
      </form>
    </Section>
  );
}
