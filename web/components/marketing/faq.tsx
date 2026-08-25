import { Eyebrow } from "./brand";

const PERGUNTAS = [
  {
    q: "De onde vêm as licitações?",
    a: "Do PNCP, o Portal Nacional de Contratações Públicas — a fonte oficial do governo federal, onde órgãos de todo o país publicam suas contratações. O agente sincroniza essa base duas vezes por dia.",
  },
  {
    q: "O que exatamente o agente lê?",
    a: "O edital e os documentos publicados junto com a licitação: objeto, requisitos de habilitação, prazos, itens e valores estimados. É essa leitura, e não só o título da licitação, que alimenta a análise de encaixe.",
  },
  {
    q: "O agente envia a proposta por mim?",
    a: "Não. Ele analisa, prioriza e recomenda. A decisão de disputar e o envio da proposta continuam com você, no portal oficial da licitação.",
  },
  {
    q: "Como o encaixe é calculado?",
    a: "Comparando o edital com o perfil que você cadastrou: CNAEs da empresa, documentos de habilitação disponíveis, capacidade de atendimento e o preço-alvo definido por item. Cada resultado vem com a justificativa escrita, não só com uma nota.",
  },
  {
    q: "Os dados da minha empresa ficam visíveis para outras?",
    a: "Não. Cada empresa é um espaço isolado: usuários, documentos e análises só aparecem para quem pertence àquele CNPJ. O acesso de cada pessoa é concedido por convite de quem administra a conta.",
  },
  {
    q: "Preciso pagar alguma coisa para começar?",
    a: "Não. Durante o beta o uso é gratuito e não pedimos cartão de crédito. Você cria a conta pelo CNPJ e o agente começa a trabalhar.",
  },
];

export function Faq() {
  return (
    <section id="faq" className="bg-sand">
      <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-28">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,0.7fr)_minmax(0,1fr)] lg:gap-20">
          <div className="lg:sticky lg:top-16 lg:self-start">
            <Eyebrow tone="light">Perguntas</Eyebrow>
            <h2 className="font-editorial mt-6 text-[clamp(1.9rem,4.6vw,2.9rem)] leading-[1.08] font-semibold tracking-[-0.02em] text-ink text-balance">
              O que costumam perguntar antes de criar a conta.
            </h2>
          </div>

          <div className="border-t border-sand-line">
            {PERGUNTAS.map((item) => (
              <details key={item.q} className="group border-b border-sand-line">
                <summary className="flex cursor-pointer list-none items-start justify-between gap-6 py-6 text-[17px] leading-snug font-medium text-ink transition-colors hover:text-accent [&::-webkit-details-marker]:hidden">
                  {item.q}
                  <span
                    aria-hidden="true"
                    className="mt-1 shrink-0 text-accent transition-transform duration-200 group-open:rotate-45"
                  >
                    <svg
                      viewBox="0 0 20 20"
                      className="h-4 w-4"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                    >
                      <path d="M10 3.5v13M3.5 10h13" />
                    </svg>
                  </span>
                </summary>
                <p className="max-w-2xl pb-7 text-[15px] leading-relaxed text-ink-muted">
                  {item.a}
                </p>
              </details>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
