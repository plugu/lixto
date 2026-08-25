import Link from "next/link";
import { CtaPrimary, Logo } from "./brand";

const COLUNAS = [
  {
    titulo: "Produto",
    links: [
      { href: "#agente", label: "O agente" },
      { href: "#como-funciona", label: "Como funciona" },
      { href: "#preco", label: "Preço" },
      { href: "#faq", label: "Perguntas" },
    ],
  },
  {
    titulo: "Conta",
    links: [
      { href: "/signup", label: "Criar conta" },
      { href: "/login", label: "Entrar" },
    ],
  },
];

export function SiteFooter() {
  const ano = new Date().getFullYear();

  return (
    <footer className="bg-night text-canvas">
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <div className="flex flex-col gap-6 border-b border-night-line py-14 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="font-editorial max-w-lg text-[clamp(1.7rem,4vw,2.4rem)] leading-[1.1] font-semibold tracking-[-0.02em] text-balance">
            Deixe o garimpo com o agente.
          </h2>
          <CtaPrimary onDark>Criar conta grátis</CtaPrimary>
        </div>

        <div className="grid gap-10 py-14 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))]">
          <div>
            <Logo />
            <p className="mt-4 max-w-xs text-[14px] leading-relaxed text-canvas/50">
              Agente autônomo de licitações públicas. Busca, lê e mede o encaixe
              dos editais do PNCP com a sua empresa.
            </p>
          </div>

          {COLUNAS.map((coluna) => (
            <nav key={coluna.titulo} aria-label={coluna.titulo}>
              <h3 className="text-[12px] font-semibold tracking-[0.16em] text-canvas/35 uppercase">
                {coluna.titulo}
              </h3>
              <ul className="mt-4 space-y-2.5 text-[14px] text-canvas/65">
                {coluna.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="transition-colors hover:text-mint"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}

          <div>
            <h3 className="text-[12px] font-semibold tracking-[0.16em] text-canvas/35 uppercase">
              Contato
            </h3>
            <ul className="mt-4 space-y-2.5 text-[14px] text-canvas/65">
              <li>
                <a
                  href="mailto:contato@lixto.com.br"
                  className="transition-colors hover:text-mint"
                >
                  contato@lixto.com.br
                </a>
              </li>
              <li className="text-canvas/40">Atendimento em dias úteis</li>
            </ul>
          </div>
        </div>

        <div className="flex flex-col gap-2 border-t border-night-line py-8 text-[13px] text-canvas/35 sm:flex-row sm:items-center sm:justify-between">
          <p>© {ano} Lixto</p>
          <p>
            Dados públicos do Portal Nacional de Contratações Públicas (PNCP).
          </p>
        </div>
      </div>
    </footer>
  );
}
