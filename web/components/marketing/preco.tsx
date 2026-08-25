import { CtaPrimary, Eyebrow } from "./brand";

const INCLUI = [
  "Monitoramento contínuo dos portais de licitação",
  "Leitura e análise dos editais publicados",
  "Score de encaixe com justificativa em texto",
  "Match por CNAE e preço-alvo por item",
  "Documentos de habilitação guardados no lugar",
  "Vários usuários na mesma empresa, com convite",
];

function Check() {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden="true"
      className="mt-0.5 h-4 w-4 shrink-0 text-mint"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 10.5 8 14.5l8-9" />
    </svg>
  );
}

export function Preco() {
  return (
    <section id="preco" className="bg-canvas">
      <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-28">
        <div className="mx-auto max-w-3xl text-center">
          <div className="flex justify-center">
            <Eyebrow tone="light">Preço</Eyebrow>
          </div>
          <h2 className="font-editorial mt-6 text-[clamp(2.1rem,5.4vw,3.4rem)] leading-[1.05] font-semibold tracking-[-0.02em] text-ink">
            Grátis durante o beta
          </h2>
          <p className="mt-5 text-[16px] leading-relaxed text-ink-muted">
            Enquanto o Lixto está em beta, o agente trabalha sem custo para as
            empresas cadastradas. Sem cartão, sem plano, sem pegadinha — e quando
            houver preço, você fica sabendo antes.
          </p>
        </div>

        <div className="mx-auto mt-12 max-w-3xl overflow-hidden rounded-3xl bg-night text-canvas shadow-[0_24px_60px_-30px_rgba(6,21,18,0.6)]">
          <div className="relative overflow-hidden border-b border-night-line px-8 py-9 sm:px-10">
            <div aria-hidden="true" className="mkt-glow absolute inset-0 opacity-60" />
            <div className="relative flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-[13px] font-semibold tracking-[0.14em] text-mint uppercase">
                  Plano beta
                </p>
                <p className="font-editorial mt-3 text-[52px] leading-none font-semibold">
                  R$ 0
                  <span className="ml-2 font-sans text-[15px] font-normal text-canvas/50">
                    por mês
                  </span>
                </p>
              </div>
              <p className="max-w-[16rem] text-[14px] leading-relaxed text-canvas/65">
                Uma empresa, quantas licitações os portais publicarem.
              </p>
            </div>
          </div>

          <div className="px-8 py-9 sm:px-10">
            <ul className="grid gap-x-8 gap-y-3.5 sm:grid-cols-2">
              {INCLUI.map((item) => (
                <li key={item} className="flex gap-3 text-[15px] leading-relaxed text-canvas/75">
                  <Check />
                  {item}
                </li>
              ))}
            </ul>

            <div className="mt-9 flex flex-col items-start gap-4 border-t border-night-line pt-8 sm:flex-row sm:items-center">
              <CtaPrimary onDark>Criar conta grátis</CtaPrimary>
              <p className="text-[13px] text-canvas/45">
                Cadastro pelo CNPJ. Sem cartão de crédito.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
