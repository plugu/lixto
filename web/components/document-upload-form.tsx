"use client";

import { useActionState } from "react";
import {
  uploadDocumentAction,
  type UploadState,
} from "@/app/(app)/company/documents/actions";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { Section } from "@/components/ui/section";
import { DOCUMENT_KINDS } from "@/lib/types";

const INITIAL_STATE: UploadState = {};

export function DocumentUploadForm() {
  const [state, formAction, pending] = useActionState(
    uploadDocumentAction,
    INITIAL_STATE,
  );

  return (
    <Section title="Enviar documento">
      <form
        action={formAction}
        className="flex flex-col gap-4 md:flex-row md:flex-wrap md:items-end"
      >
        <Field label="Tipo">
          <Select name="kind" required>
            {DOCUMENT_KINDS.map((kind) => (
              <option key={kind.value} value={kind.value}>
                {kind.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Validade (opcional)">
          <Input type="date" name="validUntil" />
        </Field>

        <Field label="Arquivo">
          <Input type="file" name="file" accept=".pdf,.jpg,.jpeg,.png" required />
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
