import { CtaPrimary, Eyebrow } from "./brand";

const PASSOS = [
  {
    n: "1",
    titulo: "Cadastre sua empresa",
    texto:
      "Digite o CNPJ e o cadastro se preenche sozinho: razão social, porte e CNAEs. Você ajusta o perfil, define o preço-alvo e sobe os documentos de habilitação.",
    tempo: "Uma vez, em minutos",
  },
  {
    n: "2",
    titulo: "O agente entra em campo",
    texto:
      "Todo dia, sem você lembrar dele: sincroniza o PNCP, lê os editais novos, extrai requisitos e prazos e pontua cada licitação contra o seu perfil.",
    tempo: "Todo dia, sozinho",
  },
  {
    n: "3",
    titulo: "Você recebe só o que vale",
    texto:
      "No painel, as licitações chegam ordenadas por encaixe, com prazo, itens e o porquê de cada score. O que não serve o agente já descartou por você.",
    tempo: "Minutos por dia",
  },
];

export function ComoFunciona() {
  return (
    <section id="como-funciona" className="bg-sand">
      <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-28">
        <div className="max-w-2xl">
          <Eyebrow tone="light">Como funciona</Eyebrow>
          <h2 className="font-editorial mt-6 text-[clamp(1.9rem,4.6vw,2.9rem)] leading-[1.08] font-semibold tracking-[-0.02em] text-ink text-balance">
            Três passos e ele começa a trabalhar.
          </h2>
        </div>

        <ol className="mt-14 grid gap-px overflow-hidden rounded-2xl border border-sand-line bg-sand-line md:grid-cols-3">
          {PASSOS.map((passo) => (
            <li key={passo.n} className="flex flex-col bg-surface p-8">
              <span
                aria-hidden="true"
                className="font-editorial text-[64px] leading-none font-semibold text-accent/25"
              >
                {passo.n}
              </span>
              <h3 className="mt-6 text-[18px] font-semibold text-ink">
                {passo.titulo}
              </h3>
              <p className="mt-3 flex-1 text-[15px] leading-relaxed text-ink-muted">
                {passo.texto}
              </p>
              <p className="mt-6 inline-flex items-center gap-2 text-[12px] font-semibold tracking-[0.1em] text-accent uppercase">
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-accent" />
                {passo.tempo}
              </p>
            </li>
          ))}
        </ol>

        <div className="mt-10 flex flex-col items-start gap-4 sm:flex-row sm:items-center">
          <CtaPrimary>Começar pelo CNPJ</CtaPrimary>
          <p className="text-[14px] text-ink-muted">
            O agente começa a rodar assim que a empresa estiver cadastrada.
          </p>
        </div>
      </div>
    </section>
  );
}
