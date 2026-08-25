import { Eyebrow } from "./brand";

const DORES = [
  {
    n: "01",
    titulo: "O volume não cabe no seu dia",
    texto:
      "Órgãos de todo o país publicam no PNCP o dia inteiro. Acompanhar na mão vira um trabalho em tempo integral — e ninguém tem alguém só para isso.",
  },
  {
    n: "02",
    titulo: "O edital está preso dentro de um PDF",
    texto:
      "Objeto, requisitos de habilitação, planilha de itens, anexos. Tudo em documento longo, muitas vezes escaneado, escrito para juristas.",
  },
  {
    n: "03",
    titulo: "O prazo vence calado",
    texto:
      "Entre a publicação e a abertura da sessão a janela é curta. Descobrir tarde é perder a disputa inteira, mesmo quando você era o fornecedor certo.",
  },
  {
    n: "04",
    titulo: "A triagem come o tempo da proposta",
    texto:
      "Horas separando o que serve do que não serve são horas a menos montando a proposta que ganha. O trabalho que importa fica para o fim.",
  },
];

export function Problema() {
  return (
    <section id="problema" className="bg-canvas">
      <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-28">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1fr)] lg:gap-20">
          <div className="lg:sticky lg:top-16 lg:self-start">
            <Eyebrow tone="light">Hoje</Eyebrow>
            <h2 className="font-editorial mt-6 text-[clamp(1.9rem,4.6vw,2.9rem)] leading-[1.08] font-semibold tracking-[-0.02em] text-ink text-balance">
              Licitação, do jeito que se faz hoje, é garimpo manual.
            </h2>
            <p className="mt-6 max-w-md text-[16px] leading-relaxed text-ink-muted">
              Quem toca uma empresa de porte médio não tem uma equipe dedicada a
              ler editais. Tem um dia útil — e ele já está cheio.
            </p>
          </div>

          <ul className="border-t border-line">
            {DORES.map((dor) => (
              <li
                key={dor.n}
                className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-5 gap-y-2 border-b border-line py-7 sm:gap-x-8"
              >
                <span className="font-editorial text-[15px] leading-7 text-ink-faint tabular-nums">
                  {dor.n}
                </span>
                <h3 className="text-[17px] leading-7 font-semibold text-ink">
                  {dor.titulo}
                </h3>
                <p className="col-start-2 text-[15px] leading-relaxed text-ink-muted">
                  {dor.texto}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
