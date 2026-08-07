import Link from "next/link";

export function Sidebar() {
  return (
    <aside className="sticky top-0 flex h-screen w-64 shrink-0 flex-col gap-8 border-r border-border bg-card/80 px-5 py-6 backdrop-blur-sm">
      <Link href="/" className="px-3">
        <span className="font-display text-lg font-bold tracking-tight text-foreground">
          Plataforma Licitante
        </span>
      </Link>

      <nav aria-label="Navegação principal" className="flex flex-col gap-1">
        <p className="px-3 pb-1 text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">
          Painel
        </p>
        <Link
          href="/"
          className="relative flex items-center rounded-lg bg-muted px-3 py-2 text-sm font-medium text-foreground"
        >
          <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-primary" />
          Licitações
        </Link>
      </nav>

      <div className="flex-1" />

      <p className="px-1 text-[0.65rem] leading-relaxed text-muted-foreground/70">
        Dados do PNCP — Portal Nacional de Contratações Públicas. Sincronização
        duas vezes ao dia.
      </p>
    </aside>
  );
}
