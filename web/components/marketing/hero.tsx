import { CtaPrimary, CtaSecondary } from "./brand";
import { HeroVisual } from "./hero-visual";

export function Hero() {
  return (
    <section className="relative overflow-hidden bg-night text-canvas">
      <div aria-hidden="true" className="mkt-grid absolute inset-0" />
      <div aria-hidden="true" className="mkt-glow absolute inset-x-0 -top-40 h-[520px]" />

      <div className="relative mx-auto grid max-w-6xl gap-14 px-5 pt-10 pb-20 sm:px-8 sm:pt-16 sm:pb-28 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.95fr)] lg:items-center lg:gap-16">
        <div>
          <p className="inline-flex items-center gap-2.5 rounded-full border border-night-line bg-night-raised/70 py-1.5 pr-4 pl-3 text-[13px] text-mint">
            <span className="relative flex h-2 w-2">
              <span className="mkt-pulse absolute inline-flex h-full w-full rounded-full bg-mint opacity-70" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-mint" />
            </span>
            Beta aberto — uso gratuito
          </p>

          <h1 className="font-editorial mt-7 text-[clamp(2.4rem,7.5vw,4.25rem)] leading-[1.02] font-semibold tracking-[-0.02em] text-balance">
            Seu agente de licitações{" "}
            <em className="text-mint">trabalha por você.</em>
          </h1>

          <p className="mt-7 max-w-xl text-[17px] leading-relaxed text-canvas/70">
            O Lixto vasculha o PNCP inteiro duas vezes por dia, lê os editais
            de ponta a ponta e mede o encaixe com o perfil da sua empresa. Você
            não procura, não filtra, não faz triagem — só decide o que disputar.
          </p>

          <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:items-center">
            <CtaPrimary onDark>Criar conta grátis</CtaPrimary>
            <CtaSecondary href="#agente" onDark>
              Ver o que o agente faz
            </CtaSecondary>
          </div>

          <p className="mt-6 text-[13px] text-canvas/45">
            Cadastro pelo CNPJ · sem cartão de crédito · leva menos de 2 minutos
          </p>
        </div>

        <div className="relative lg:pl-4">
          <HeroVisual />
        </div>
      </div>

      <div aria-hidden="true" className="h-px bg-night-line" />
    </section>
  );
}
