import Link from "next/link";
import { Logo } from "./brand";

const NAV = [
  { href: "#agente", label: "O agente" },
  { href: "#como-funciona", label: "Como funciona" },
  { href: "#preco", label: "Preço" },
  { href: "#faq", label: "Perguntas" },
];

export function SiteHeader() {
  return (
    <header className="relative z-10 bg-night text-canvas">
      <div className="mx-auto flex h-20 max-w-6xl items-center justify-between gap-4 px-5 sm:px-8">
        <Link
          href="/"
          aria-label="Lixto — início"
          className="text-canvas transition-opacity hover:opacity-80"
        >
          <Logo />
        </Link>

        <nav aria-label="Seções da página" className="hidden lg:block">
          <ul className="flex items-center gap-8 text-[14px] text-canvas/65">
            {NAV.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="transition-colors hover:text-mint"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex items-center gap-2 sm:gap-4">
          <Link
            href="/login"
            className="rounded-full px-3 py-2 text-[14px] text-canvas/70 transition-colors hover:text-mint"
          >
            Entrar
          </Link>
          <Link
            href="/signup"
            className="inline-flex h-10 items-center rounded-full bg-mint px-4 text-[14px] font-medium text-night transition-colors hover:bg-mint/85 sm:px-5"
          >
            Criar conta
          </Link>
        </div>
      </div>
    </header>
  );
}
