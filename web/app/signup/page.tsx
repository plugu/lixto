import { SignupForm } from "@/components/signup-form";
import { LinkButton } from "@/components/ui/button";

export default function SignupPage() {
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center gap-10 py-10">
      <span className="font-display text-2xl italic text-ink">Licitante</span>

      <div className="flex w-full flex-col gap-6">
        <div className="flex flex-col gap-1 text-center">
          <h1 className="font-display text-[28px] leading-[34px] text-ink">
            Criar conta
          </h1>
          <p className="text-sm text-ink-muted">
            Cadastre sua empresa na Plataforma Licitante.
          </p>
        </div>

        <SignupForm />

        <p className="text-center text-[13px] text-ink-muted">
          Já tem conta?{" "}
          <LinkButton href="/login" variant="ghost" size="sm">
            Entrar
          </LinkButton>
        </p>
      </div>
    </div>
  );
}
