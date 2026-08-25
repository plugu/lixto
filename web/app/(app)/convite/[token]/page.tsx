import { aceitarConviteAction } from "./actions";
import { getConvite } from "@/lib/usuario-queries";
import { Field, Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

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
      <div className="mx-auto flex min-h-[70vh] max-w-sm flex-col items-center justify-center gap-10 text-center">
        <span className="font-display text-2xl italic text-ink">
          Licitante
        </span>
        <div className="flex flex-col gap-2">
          <h1 className="font-display text-[28px] leading-[34px] text-ink">
            Convite inválido ou expirado.
          </h1>
          <p className="text-sm text-ink-muted">
            Peça ao administrador da empresa para gerar um novo convite.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-sm flex-col items-center justify-center gap-10">
      <span className="font-display text-2xl italic text-ink">Licitante</span>

      <div className="flex w-full flex-col gap-6">
        <div className="flex flex-col gap-1 text-center">
          <h1 className="font-display text-[28px] leading-[34px] text-ink">
            Você foi convidado para{" "}
            <span className="italic">{convite.empresaRazaoSocial}</span>
          </h1>
          <p className="text-sm text-ink-muted">
            Defina sua senha para acessar a plataforma.
          </p>
        </div>

        {erro ? (
          <p
            role="alert"
            className="rounded-md bg-warn-soft px-3 py-2 text-sm text-warn"
          >
            {erro}
          </p>
        ) : null}

        <form
          action={aceitarConviteAction}
          className="flex flex-col gap-5"
        >
          <input type="hidden" name="token" value={token} />

          <Field label="Nome">
            <Input type="text" name="nome" defaultValue={convite.nome} required />
          </Field>

          <Field label="E-mail">
            <Input
              type="email"
              value={convite.email}
              readOnly
              disabled
              className="opacity-70"
            />
          </Field>

          <Field label="Senha">
            <Input
              type="password"
              name="senha"
              autoComplete="new-password"
              required
              minLength={8}
            />
          </Field>

          <Field label="Confirmar senha">
            <Input
              type="password"
              name="confirmarSenha"
              autoComplete="new-password"
              required
              minLength={8}
            />
          </Field>

          <Field label="CPF (opcional)">
            <Input type="text" name="cpf" />
          </Field>

          <Field label="Telefone">
            <Input type="text" name="telefone" />
          </Field>

          <Field label="Cargo">
            <Input type="text" name="cargo" />
          </Field>

          <Button type="submit" variant="primary" size="md" className="w-full">
            Entrar
          </Button>
        </form>
      </div>
    </div>
  );
}
