import { loginAction } from "./actions";
import { Field, Input } from "@/components/ui/input";
import { Button, LinkButton } from "@/components/ui/button";

function first(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export default async function LoginPage({
  searchParams,
}: PageProps<"/login">) {
  const params = await searchParams;
  const erro = first(params.erro) === "1";
  const nextParam = first(params.next);
  const next =
    nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "";

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-sm flex-col items-center justify-center gap-10">
      <span className="font-display text-2xl italic text-ink">Lixto</span>

      <div className="flex w-full flex-col gap-6">
        <div className="flex flex-col gap-1 text-center">
          <h1 className="font-display text-[28px] leading-[34px] text-ink">
            Entrar
          </h1>
          <p className="text-sm text-ink-muted">
            Acesse sua conta do Lixto.
          </p>
        </div>

        {erro ? (
          <p
            role="alert"
            className="rounded-md bg-warn-soft px-3 py-2 text-sm text-warn"
          >
            E-mail ou senha inválidos.
          </p>
        ) : null}

        <form action={loginAction} className="flex flex-col gap-5">
          <input type="hidden" name="next" value={next} />

          <Field label="E-mail">
            <Input type="email" name="email" autoComplete="email" required />
          </Field>

          <Field label="Senha">
            <Input
              type="password"
              name="password"
              autoComplete="current-password"
              required
            />
          </Field>

          <Button type="submit" variant="primary" size="md" className="w-full">
            Entrar
          </Button>
        </form>

        <p className="text-center text-[13px] text-ink-muted">
          Ainda não tem conta?{" "}
          <LinkButton href="/signup" variant="ghost" size="sm">
            Criar conta
          </LinkButton>
        </p>
      </div>
    </div>
  );
}
