import Link from "next/link";
import { loginAction } from "./actions";

const INPUT_CLASS =
  "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm shadow-subtle outline-none focus-visible:ring-2 focus-visible:ring-accent/40";

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
    <div className="mx-auto mt-24 max-w-sm rounded-lg border border-border bg-card p-8 shadow-subtle">
      <h1 className="font-display text-2xl font-bold tracking-tight">Entrar</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Acesse sua conta da Plataforma Licitante.
      </p>

      {erro ? (
        <p
          role="alert"
          className="mt-5 rounded-lg border border-unclear/30 bg-unclear/10 px-3 py-2 text-sm text-foreground"
        >
          E-mail ou senha inválidos.
        </p>
      ) : null}

      <form action={loginAction} className="mt-6 flex flex-col gap-4">
        <input type="hidden" name="next" value={next} />

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            E-mail
          </span>
          <input
            type="email"
            name="email"
            autoComplete="email"
            required
            className={INPUT_CLASS}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            Senha
          </span>
          <input
            type="password"
            name="senha"
            autoComplete="current-password"
            required
            className={INPUT_CLASS}
          />
        </label>

        <button
          type="submit"
          className="mt-1 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-all duration-150 hover:bg-primary/90 active:scale-[0.98]"
        >
          Entrar
        </button>
      </form>

      <p className="mt-6 text-center text-xs text-muted-foreground">
        Ainda não tem conta?{" "}
        <Link href="/signup" className="font-medium text-accent hover:underline">
          Criar conta
        </Link>
      </p>
    </div>
  );
}
