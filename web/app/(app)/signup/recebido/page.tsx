import Link from "next/link";
import { Logo } from "@/components/marketing/brand";
import { LinkButton } from "@/components/ui/button";

export const metadata = { title: "Cadastro recebido — Lixto" };

export default function SignupReceivedPage() {
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-sm flex-col items-center justify-center gap-10">
      <Link href="/" aria-label="Lixto" className="flex items-center text-ink">
        <Logo />
      </Link>

      <div className="flex w-full flex-col gap-6">
        <div className="flex flex-col gap-1 text-center">
          <h1 className="font-display text-[28px] leading-[34px] text-ink">
            Cadastro recebido
          </h1>
          <p className="text-sm text-ink-muted">
            Estamos avaliando os dados da sua empresa. Você receberá um
            e-mail assim que o acesso for liberado.
          </p>
        </div>

        <div className="flex justify-center">
          <LinkButton href="/" variant="ghost" size="sm">
            Voltar ao início
          </LinkButton>
        </div>
      </div>
    </div>
  );
}
