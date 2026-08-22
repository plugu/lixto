"use client";

import { useActionState } from "react";
import { uploadDocumentoAction, type UploadState } from "@/app/empresa/documentos/actions";
import { DOCUMENTO_TIPOS } from "@/lib/tenant-types";

const INPUT_CLASS =
  "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm shadow-subtle outline-none focus-visible:ring-2 focus-visible:ring-accent/40";

const INITIAL_STATE: UploadState = {};

export function DocumentoUploadForm() {
  const [state, formAction, pending] = useActionState(
    uploadDocumentoAction,
    INITIAL_STATE,
  );

  return (
    <form action={formAction} className="mt-4 flex flex-wrap items-end gap-4">
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">Tipo</span>
        <select name="tipo" required className={`${INPUT_CLASS} max-w-56`}>
          {DOCUMENTO_TIPOS.map((tipo) => (
            <option key={tipo.value} value={tipo.value}>
              {tipo.label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">
          Validade (opcional)
        </span>
        <input type="date" name="validade" className={INPUT_CLASS} />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">Arquivo</span>
        <input
          type="file"
          name="arquivo"
          accept=".pdf,.jpg,.jpeg,.png"
          required
          className={INPUT_CLASS}
        />
      </label>

      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-all duration-150 hover:bg-primary/90 active:scale-[0.98] disabled:opacity-60"
      >
        {pending ? "Enviando…" : "Enviar"}
      </button>

      {state.error ? (
        <p role="alert" className="w-full text-sm text-unclear">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
