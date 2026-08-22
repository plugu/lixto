"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type SidebarSession = {
  nome: string;
  empresa: string;
  role: string;
};

const NAV_ITEMS = [
  { href: "/", label: "Visão geral" },
  { href: "/licitacoes", label: "Licitações" },
] as const;

const EMPRESA_ITEMS = [{ href: "/empresa", label: "Minha empresa" }] as const;

const EMPRESA_ADMIN_ITEMS = [
  { href: "/empresa/usuarios", label: "Usuários" },
  { href: "/empresa/documentos", label: "Documentos" },
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  if (href === "/empresa") return pathname === "/empresa";
  if (href === "/licitacoes") {
    return pathname === href || pathname.startsWith("/licitacao");
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLink({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  const active = isActive(pathname, href);
  return (
    <Link
      href={href}
      className={`relative flex items-center rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
        active
          ? "bg-muted text-foreground"
          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
      }`}
    >
      <span
        className={`absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-primary transition-opacity ${
          active ? "opacity-100" : "opacity-0"
        }`}
      />
      {label}
    </Link>
  );
}

export function Sidebar({ session }: { session: SidebarSession | null }) {
  // Logged out (e.g. /login, /signup): no chrome at all.
  if (!session) return null;

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
        {NAV_ITEMS.map((item) => (
          <NavLink key={item.href} href={item.href} label={item.label} />
        ))}

        <p className="mt-5 px-3 pb-1 text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">
          Empresa
        </p>
        {EMPRESA_ITEMS.map((item) => (
          <NavLink key={item.href} href={item.href} label={item.label} />
        ))}
        {session.role === "admin"
          ? EMPRESA_ADMIN_ITEMS.map((item) => (
              <NavLink key={item.href} href={item.href} label={item.label} />
            ))
          : null}
      </nav>

      <div className="flex-1" />

      <div className="flex flex-col gap-1 px-1">
        <span className="text-sm font-medium text-foreground">
          {session.empresa}
        </span>
        <span className="text-xs text-muted-foreground">{session.nome}</span>
        <form action="/logout" method="post" className="mt-2">
          <button
            type="submit"
            className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground hover:underline"
          >
            Sair
          </button>
        </form>
      </div>
    </aside>
  );
}
