"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { Section } from "@/components/ui/section";
import {
  createInviteAction,
  type CreateInviteState,
} from "@/app/(app)/company/users/actions";

const INITIAL_STATE: CreateInviteState = {};

export function InviteForm({ origin }: { origin: string }) {
  const [state, formAction, pending] = useActionState(
    createInviteAction,
    INITIAL_STATE,
  );
  const [copied, setCopied] = useState(false);

  const inviteUrl = state.token ? `${origin}/invite/${state.token}` : null;

  async function copyLink() {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
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
          <Input type="text" name="name" required />
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

      {inviteUrl ? (
        <div className="mt-4">
          <Field label="Link do convite — envie para o convidado">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Input
                type="text"
                readOnly
                value={inviteUrl}
                onFocus={(e) => e.currentTarget.select()}
                className="min-w-0 font-mono text-xs"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={copyLink}
                className="self-start sm:self-auto"
              >
                {copied ? "Copiado" : "Copiar"}
              </Button>
            </div>
          </Field>
        </div>
      ) : null}
    </Section>
  );
}
