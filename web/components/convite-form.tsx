"use client";

import { useActionState } from "react";
import {
  criarConviteAction,
  type CriarConviteState,
} from "@/app/empresa/usuarios/actions";

const INPUT_CLASS =
  "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm shadow-subtle outline-none focus-visible:ring-2 focus-visible:ring-accent/40";

const INITIAL_STATE: CriarConviteState = {};

export function ConviteForm({ origin }: { origin: string }) {
  const [state, formAction, pending] = useActionState(
    criarConviteAction,
    INITIAL_STATE,
  );

  const conviteUrl = state.token ? `${origin}/convite/${state.token}` : null;

  return (
    <div className="rounded-lg border border-border bg-card p-6 shadow-subtle">
      <h2 className="font-display text-lg font-semibold tracking-tight">
        Convidar usuário
      </h2>

      <form action={formAction} className="mt-4 flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            Nome
          </span>
          <input type="text" name="nome" required className={INPUT_CLASS} />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            E-mail
          </span>
          <input type="email" name="email" required className={INPUT_CLASS} />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            Papel
          </span>
          <select
            name="role"
            defaultValue="member"
            className={`${INPUT_CLASS} max-w-56`}
          >
            <option value="member">Membro</option>
            <option value="admin">Administrador</option>
          </select>
        </label>

        {state.erro ? (
          <p
            role="alert"
            className="rounded-lg border border-unclear/30 bg-unclear/10 px-3 py-2 text-sm text-foreground"
          >
            {state.erro}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={pending}
          className="mt-1 self-start rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-all duration-150 hover:bg-primary/90 active:scale-[0.98] disabled:opacity-60"
        >
          Gerar convite
        </button>
      </form>

      {conviteUrl ? (
        <div className="mt-4 flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            Link do convite — envie para o convidado
          </span>
          <input
            type="text"
            readOnly
            value={conviteUrl}
            onFocus={(e) => e.currentTarget.select()}
            className={`${INPUT_CLASS} font-mono text-xs`}
          />
        </div>
      ) : null}
    </div>
  );
}
