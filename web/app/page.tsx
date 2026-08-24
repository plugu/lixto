import { LinkButton, Button } from "@/components/ui/button";
import { SearchBox } from "@/components/ui/search-box";
import { Chevron, List } from "@/components/ui/icons";
import { StatTile } from "@/components/charts/stat-tile";
import { fetchStatusCounts } from "@/lib/stats-queries";

export const dynamic = "force-dynamic";

const CHIPS: { label: string; href: string }[] = [
  { label: "O que fecha esta semana?", href: "/licitacoes?status=aberta" },
  { label: "Meus melhores fits", href: "/licitacoes?fit=fit" },
  { label: "Vão abrir", href: "/licitacoes?status=vai_abrir" },
  { label: "Valor médio por modalidade", href: "/painel" },
];

export default async function Home() {
  const counts = await fetchStatusCounts();

  return (
    <div className="flex min-h-[calc(100vh-5rem)] flex-col items-center justify-center gap-8">
      <div className="flex w-full max-w-2xl flex-col items-center gap-3 text-center">
        <h1 className="font-display text-[44px] leading-[48px] text-ink">
          O que você quer saber{" "}
          <em className="italic text-accent">hoje</em>?
        </h1>
        <p className="text-[15px] text-ink-muted">
          Pergunte em português sobre as {counts.abertas} licitações abertas
          — o agente consulta a base e responde.
        </p>
      </div>

      <div className="w-full max-w-2xl">
        <SearchBox
          size="hero"
          name="q"
          action="/licitacoes"
          placeholder="Ex.: pregões de material escolar em SP que fecham esta semana"
        >
          <Button variant="pill" size="sm" type="button">
            <SparkleIcon size={14} />
            Agente
            <Chevron size={14} className="rotate-90" />
          </Button>
          <Button variant="pill" size="sm" type="button">
            <List size={14} />
            Abertas
            <Chevron size={14} className="rotate-90" />
          </Button>
        </SearchBox>
      </div>

      <div className="flex w-full max-w-2xl flex-wrap items-center justify-center gap-2">
        {CHIPS.map((chip) => (
          <LinkButton key={chip.label} href={chip.href} variant="pill" size="sm">
            {chip.label}
          </LinkButton>
        ))}
      </div>

      <div className="grid w-full max-w-2xl grid-cols-1 gap-4 sm:grid-cols-3">
        <StatTile label="Abertas" value={counts.abertas} />
        <StatTile label="Vão abrir" value={counts.vaiAbrir} />
        <StatTile label="Fechadas" value={counts.fechadas} />
      </div>

      <LinkButton href="/painel" variant="ghost" size="sm">
        Ver painel completo →
      </LinkButton>
    </div>
  );
}

function SparkleIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
    </svg>
  );
}
