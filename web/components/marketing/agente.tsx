import { Eyebrow } from "./brand";

function IconBusca() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="h-6 w-6"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="11" cy="11" r="6.5" />
      <path d="M11 4.5v13M4.5 11h13" opacity="0.45" />
      <path d="M16 16l4.5 4.5" />
    </svg>
  );
}

function IconAnalise() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="h-6 w-6"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 3.5h8l4.5 4.5v12.5H6z" />
      <path d="M14 3.5V8h4.5" />
      <path d="M9 12h7M9 15.5h7M9 18.5h4" opacity="0.55" />
    </svg>
  );
}

function IconFit() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="h-6 w-6"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="8.5" opacity="0.4" />
      <path d="M12 3.5a8.5 8.5 0 0 1 6.6 13.8" />
      <circle cx="12" cy="12" r="2.5" />
    </svg>
  );
}

const ETAPAS = [
  {
    n: "Etapa 1",
    icone: <IconBusca />,
    titulo: "Busca",
    chamada: "O PNCP inteiro, duas vezes por dia",
    texto:
      "O agente sincroniza com o Portal Nacional de Contratações Públicas de manhã e à noite. O alcance é a base toda — não uma lista de palavras-chave que você precisa manter.",
    tags: ["Sync 2× ao dia", "Base nacional", "Sem palavra-chave"],
  },
  {
    n: "Etapa 2",
    icone: <IconAnalise />,
    titulo: "Análise",
    chamada: "Lê o edital, não só o título",
    texto:
      "Abre os documentos publicados com a licitação e extrai o que decide a disputa: objeto, requisitos de habilitação, prazos, itens e valores estimados — inclusive quando vêm em PDF.",
    tags: ["Editais em PDF", "Requisitos", "Prazos e itens"],
  },
  {
    n: "Etapa 3",
    icone: <IconFit />,
    titulo: "Fit",
    chamada: "Diz se a briga é sua",
    texto:
      "Cruza o que leu com o perfil da sua empresa: CNAEs, documentos de habilitação, capacidade e preço-alvo por item. Cada licitação sai com um score de encaixe e a justificativa escrita em português claro.",
    tags: ["Match por CNAE", "Preço-alvo", "Score com justificativa"],
  },
];

export function Agente() {
  return (
    <section id="agente" className="relative overflow-hidden bg-night text-canvas">
      <div aria-hidden="true" className="mkt-grid absolute inset-0 opacity-70" />

      <div className="relative mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-28">
        <div className="max-w-2xl">
          <Eyebrow>O agente</Eyebrow>
          <h2 className="font-editorial mt-6 text-[clamp(1.9rem,4.6vw,2.9rem)] leading-[1.08] font-semibold tracking-[-0.02em] text-balance">
            Ele faz o trabalho inteiro — busca, leitura e julgamento de encaixe.
          </h2>
          <p className="mt-6 text-[16px] leading-relaxed text-canvas/65">
            Não é um buscador com alerta por e-mail. É um trabalhador: roda todo
            dia, no mesmo ritmo, e entrega uma decisão pronta para você conferir.
          </p>
        </div>

        <ol className="mt-14 grid gap-5 md:grid-cols-3">
          {ETAPAS.map((etapa) => (
            <li
              key={etapa.titulo}
              className="flex flex-col rounded-2xl border border-night-line bg-night-raised/60 p-7"
            >
              <div className="flex items-center justify-between">
                <span className="text-mint">{etapa.icone}</span>
                <span className="text-[11px] font-semibold tracking-[0.16em] text-canvas/35 uppercase">
                  {etapa.n}
                </span>
              </div>
              <h3 className="font-editorial mt-7 text-[26px] leading-none font-semibold text-mint">
                {etapa.titulo}
              </h3>
              <p className="mt-3 text-[16px] leading-snug font-medium text-canvas">
                {etapa.chamada}
              </p>
              <p className="mt-3 flex-1 text-[15px] leading-relaxed text-canvas/60">
                {etapa.texto}
              </p>
              <ul className="mt-8 flex flex-wrap gap-2 border-t border-night-line pt-5">
                {etapa.tags.map((tag) => (
                  <li
                    key={tag}
                    className="rounded-full border border-night-line px-3 py-1 text-[12px] text-canvas/55"
                  >
                    {tag}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>

        <div className="mt-6 flex flex-col gap-3 rounded-2xl border border-mint/25 bg-mint/[0.06] p-7 sm:flex-row sm:items-start sm:gap-6">
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            className="h-6 w-6 shrink-0 text-mint"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          >
            <circle cx="12" cy="12" r="8.75" />
            <path d="M12 7.75v5" />
            <path d="M12 16.1h.01" />
          </svg>
          <div>
            <h3 className="text-[16px] font-semibold text-canvas">
              Até onde o agente vai
            </h3>
            <p className="mt-2 max-w-3xl text-[15px] leading-relaxed text-canvas/65">
              Ele analisa, prioriza e recomenda. A decisão de disputar e o envio
              da proposta continuam com você, no portal oficial da licitação — o
              Lixto não envia proposta no seu lugar.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
