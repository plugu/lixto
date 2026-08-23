"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { Section } from "@/components/ui/section";
import {
  criarConviteAction,
  type CriarConviteState,
} from "@/app/empresa/usuarios/actions";

const INITIAL_STATE: CriarConviteState = {};

export function ConviteForm({ origin }: { origin: string }) {
  const [state, formAction, pending] = useActionState(
    criarConviteAction,
    INITIAL_STATE,
  );
  const [copied, setCopied] = useState(false);

  const conviteUrl = state.token ? `${origin}/convite/${state.token}` : null;

  async function copyLink() {
    if (!conviteUrl) return;
    try {
      await navigator.clipboard.writeText(conviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable (permissions/non-secure context) — the field
      // is still selectable manually, nothing else to do here.
    }
  }

  return (
    <Section title="Convidar usuário">
      <form action={formAction} className="flex flex-col gap-4">
        <Field label="Nome">
          <Input type="text" name="nome" required />
        </Field>

        <Field label="E-mail">
          <Input type="email" name="email" required />
        </Field>

        <Field label="Papel">
          <Select name="role" defaultValue="member">
            <option value="member">Membro</option>
            <option value="admin">Administrador</option>
          </Select>
        </Field>

        {state.erro ? (
          <p role="alert" className="text-sm text-danger">
            {state.erro}
          </p>
        ) : null}

        <Button type="submit" disabled={pending} className="self-start">
          {pending ? "Gerando…" : "Gerar convite"}
        </Button>
      </form>

      {conviteUrl ? (
        <div className="mt-4">
          <Field label="Link do convite — envie para o convidado">
            <div className="flex items-center gap-2">
              <Input
                type="text"
                readOnly
                value={conviteUrl}
                onFocus={(e) => e.currentTarget.select()}
                className="font-mono text-xs"
              />
              <Button type="button" variant="ghost" size="sm" onClick={copyLink}>
                {copied ? "Copiado" : "Copiar"}
              </Button>
            </div>
          </Field>
        </div>
      ) : null}
    </Section>
  );
}
