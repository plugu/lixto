import { aceitarConviteAction } from "./actions";
import { getConvite } from "@/lib/usuario-queries";

const INPUT_CLASS =
  "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm shadow-subtle outline-none focus-visible:ring-2 focus-visible:ring-accent/40";

function first(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export default async function ConvitePage(
  props: PageProps<"/convite/[token]">,
) {
  const { token } = await props.params;
  const searchParams = await props.searchParams;
  const erro = first(searchParams.erro);

  const convite = await getConvite(token);

  if (!convite) {
    return (
      <div className="mx-auto mt-24 max-w-sm rounded-lg border border-border bg-card p-8 shadow-subtle">
        <h1 className="font-display text-2xl font-bold tracking-tight">
          Convite inválido ou expirado.
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Peça ao administrador da empresa para gerar um novo convite.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto mt-16 max-w-sm rounded-lg border border-border bg-card p-8 shadow-subtle">
      <h1 className="font-display text-2xl font-bold tracking-tight">
        Você foi convidado para{" "}
        <strong>{convite.empresaRazaoSocial}</strong>
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Defina sua senha para acessar a plataforma.
      </p>

      {erro ? (
        <p
          role="alert"
          className="mt-5 rounded-lg border border-unclear/30 bg-unclear/10 px-3 py-2 text-sm text-foreground"
        >
          {erro}
        </p>
      ) : null}

      <form action={aceitarConviteAction} className="mt-6 flex flex-col gap-4">
        <input type="hidden" name="token" value={token} />

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            Nome
          </span>
          <input
            type="text"
            name="nome"
            defaultValue={convite.nome}
            required
            className={INPUT_CLASS}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            E-mail
          </span>
          <input
            type="email"
            value={convite.email}
            readOnly
            disabled
            className={`${INPUT_CLASS} opacity-70`}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            Senha
          </span>
          <input
            type="password"
            name="senha"
            autoComplete="new-password"
            required
            minLength={8}
            className={INPUT_CLASS}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            Confirmar senha
          </span>
          <input
            type="password"
            name="confirmarSenha"
            autoComplete="new-password"
            required
            minLength={8}
            className={INPUT_CLASS}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            CPF (opcional)
          </span>
          <input type="text" name="cpf" className={INPUT_CLASS} />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            Telefone
          </span>
          <input type="text" name="telefone" className={INPUT_CLASS} />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            Cargo
          </span>
          <input type="text" name="cargo" className={INPUT_CLASS} />
        </label>

        <button
          type="submit"
          className="mt-1 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-all duration-150 hover:bg-primary/90 active:scale-[0.98]"
        >
          Entrar
        </button>
      </form>
    </div>
  );
}
