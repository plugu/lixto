import Link from "next/link";
import { Logo } from "@/components/marketing/brand";
import { SignupForm } from "@/components/signup-form";
import { LinkButton } from "@/components/ui/button";
import { redirectIfLoggedIn } from "@/lib/public-pages";

export default async function SignupPage() {
  await redirectIfLoggedIn();
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center gap-10 py-10">
      <Link href="/" aria-label="Lixto" className="flex items-center text-ink">
        <Logo />
      </Link>

      <div className="flex w-full flex-col gap-6">
        <div className="flex flex-col gap-1 text-center">
          <h1 className="font-display text-[28px] leading-[34px] text-ink">
            Criar conta
          </h1>
          <p className="text-sm text-ink-muted">
            Cadastre sua empresa no Lixto.
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
