import Link from "next/link";
import { Logo } from "@/components/marketing/brand";
import { loginAction } from "./actions";
import { Field, Input } from "@/components/ui/input";
import { Button, LinkButton } from "@/components/ui/button";

function first(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

/** `?error=` -> alert copy. "1" is the legacy value older links still carry.
 * Anything unknown renders no alert. */
function loginErrorMessage(error: string): string | null {
  switch (error) {
    case "pending":
      return "Sua conta ainda está em análise. Avisaremos por e-mail quando o acesso for liberado.";
    case "rejected":
      return "O cadastro da sua empresa não foi aprovado. Responda ao e-mail que enviamos se tiver dúvidas.";
    case "invalid":
    case "1":
      return "E-mail ou senha inválidos.";
    default:
      return null;
  }
}

export default async function LoginPage({
  searchParams,
}: PageProps<"/login">) {
  const params = await searchParams;
  const errorMessage = loginErrorMessage(first(params.error));
  const nextParam = first(params.next);
  const next =
    nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "";

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-sm flex-col items-center justify-center gap-10">
      <Link href="/" aria-label="Lixto" className="flex items-center text-ink">
        <Logo />
      </Link>

      <div className="flex w-full flex-col gap-6">
        <div className="flex flex-col gap-1 text-center">
          <h1 className="font-display text-[28px] leading-[34px] text-ink">
            Entrar
          </h1>
          <p className="text-sm text-ink-muted">
            Acesse sua conta do Lixto.
          </p>
        </div>

        {errorMessage ? (
          <p
            role="alert"
            className="rounded-md bg-warn-soft px-3 py-2 text-sm text-warn"
          >
            {errorMessage}
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
