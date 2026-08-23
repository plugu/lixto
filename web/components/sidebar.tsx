"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType } from "react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { CommandSearch } from "@/components/ui/command-search";
import {
  Building,
  Chart,
  FileText,
  Home,
  List,
  LogOut,
  Sidebar as SidebarIcon,
  Users,
} from "@/components/ui/icons";

export type SidebarSession = {
  nome: string;
  empresa: string;
  role: string;
};

const STORAGE_KEY = "plic.sidebar";

export const NAV_ITEMS = [
  { href: "/", label: "Visão geral", icon: Home },
  { href: "/painel", label: "Painel", icon: Chart },
  { href: "/licitacoes", label: "Licitações", icon: List },
] as const;

export const EMPRESA_ITEMS = [
  { href: "/empresa", label: "Minha empresa", icon: Building },
] as const;

export const EMPRESA_ADMIN_ITEMS = [
  { href: "/empresa/usuarios", label: "Usuários", icon: Users },
  { href: "/empresa/documentos", label: "Documentos", icon: FileText },
] as const;

export function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  if (href === "/empresa") return pathname === "/empresa";
  if (href === "/licitacoes") {
    return pathname === href || pathname.startsWith("/licitacao");
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

function initials(nome: string): string {
  const parts = nome.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

function NavLink({
  href,
  label,
  icon: Icon,
  collapsed,
}: {
  href: string;
  label: string;
  icon: ComponentType<{ size?: number }>;
  collapsed: boolean;
}) {
  const pathname = usePathname();
  const active = isActive(pathname, href);
  return (
    <Link
      href={href}
      title={collapsed ? label : undefined}
      className={`flex h-8 items-center gap-2.5 rounded-md px-3 text-[13px] font-medium transition-colors ${
        active
          ? "bg-surface-raised text-ink"
          : "text-ink-muted hover:bg-surface-raised/60 hover:text-ink"
      } ${collapsed ? "justify-center px-0" : ""}`}
    >
      <Icon size={18} />
      {collapsed ? null : <span>{label}</span>}
    </Link>
  );
}

export function Sidebar({ session }: { session: SidebarSession | null }) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === "collapsed") setCollapsed(true);
    } catch {
      // localStorage unavailable (private mode, disabled) — default expanded.
    }
  }, []);

  function toggle() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? "collapsed" : "expanded");
      } catch {
        // ignore
      }
      return next;
    });
  }

  // Logged out (e.g. /login, /signup): no chrome at all.
  if (!session) return null;

  return (
    <aside
      className={`hidden h-screen shrink-0 flex-col gap-6 border-r border-line bg-canvas py-5 md:flex ${
        collapsed ? "w-14 px-2" : "w-60 px-3"
      }`}
    >
      <div className={`flex items-center ${collapsed ? "justify-center px-0" : "justify-between px-1"}`}>
        <Link href="/" className={collapsed ? "hidden" : "flex items-center"}>
          <span className="font-display text-lg italic text-ink">Licitante</span>
        </Link>
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
          className="flex h-7 w-7 items-center justify-center rounded-md text-ink-muted hover:bg-surface-raised hover:text-ink"
        >
          <SidebarIcon size={16} />
        </button>
      </div>

      {collapsed ? null : <CommandSearch />}

      <nav aria-label="Navegação principal" className="flex flex-col gap-0.5">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.href}
            href={item.href}
            label={item.label}
            icon={item.icon}
            collapsed={collapsed}
          />
        ))}

        {collapsed ? (
          <div className="my-2 h-px bg-line" />
        ) : (
          <p className="mt-5 px-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-faint">
            Empresa
          </p>
        )}
        {EMPRESA_ITEMS.map((item) => (
          <NavLink
            key={item.href}
            href={item.href}
            label={item.label}
            icon={item.icon}
            collapsed={collapsed}
          />
        ))}
        {session.role === "admin"
          ? EMPRESA_ADMIN_ITEMS.map((item) => (
              <NavLink
                key={item.href}
                href={item.href}
                label={item.label}
                icon={item.icon}
                collapsed={collapsed}
              />
            ))
          : null}
      </nav>

      <div className="flex-1" />

      <div className={`flex items-center gap-2 px-1 ${collapsed ? "flex-col" : ""}`}>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-raised text-[12px] font-semibold text-ink">
          {initials(session.nome)}
        </span>
        {collapsed ? null : (
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[13px] font-medium text-ink">
              {session.nome}
            </span>
            <span className="truncate text-[12px] text-ink-muted">
              {session.empresa}
            </span>
          </div>
        )}
        <form action="/logout" method="post">
          <Button type="submit" variant="ghost" size="sm" aria-label="Sair" className={collapsed ? "!px-0" : ""}>
            <LogOut size={14} />
            {collapsed ? null : "Sair"}
          </Button>
        </form>
      </div>
    </aside>
  );
}
