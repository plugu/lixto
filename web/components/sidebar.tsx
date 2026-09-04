"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType } from "react";
import { useSyncExternalStore } from "react";
import { Logo, LogoMark } from "@/components/marketing/brand";
import { Button } from "@/components/ui/button";
import { CommandSearch } from "@/components/ui/command-search";
import {
  Building,
  Chart,
  FileText,
  List,
  LogOut,
  Sidebar as SidebarIcon,
  Tag,
  Users,
} from "@/components/ui/icons";
// Chart is still used by the "Painel" nav item below.

export type SidebarSession = {
  name: string;
  company: string;
  role: string;
};

const STORAGE_KEY = "lixto.sidebar";

// Collapsed state lives in a module-level store read through
// useSyncExternalStore (server snapshot = expanded) so we avoid a
// setState-in-effect hydration dance while still surviving reloads.
let collapsedStore: boolean | null = null;
const collapsedListeners = new Set<() => void>();

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "collapsed";
  } catch {
    // localStorage unavailable (private mode, disabled) — default expanded.
    return false;
  }
}

function getCollapsedSnapshot(): boolean {
  if (collapsedStore === null) collapsedStore = readCollapsed();
  return collapsedStore;
}

function getCollapsedServerSnapshot(): boolean {
  return false;
}

function subscribeCollapsed(listener: () => void): () => void {
  collapsedListeners.add(listener);
  return () => {
    collapsedListeners.delete(listener);
  };
}

function setCollapsedStore(next: boolean) {
  collapsedStore = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, next ? "collapsed" : "expanded");
  } catch {
    // ignore
  }
  for (const listener of collapsedListeners) listener();
}

export const NAV_ITEMS = [
  { href: "/opportunities", label: "Oportunidades", icon: Tag },
  { href: "/dashboard", label: "Painel", icon: Chart },
  { href: "/procurements", label: "Licitações", icon: List },
] as const;

export const COMPANY_ITEMS = [
  { href: "/company", label: "Minha empresa", icon: Building },
  { href: "/company/profile", label: "Match", icon: Tag },
] as const;

export const COMPANY_ADMIN_ITEMS = [
  { href: "/company/users", label: "Usuários", icon: Users },
  { href: "/company/documents", label: "Documentos", icon: FileText },
] as const;

export function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  if (href === "/company") return pathname === "/company";
  if (href === "/procurements") {
    return pathname === href || pathname.startsWith("/procurement/");
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
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
  const collapsed = useSyncExternalStore(
    subscribeCollapsed,
    getCollapsedSnapshot,
    getCollapsedServerSnapshot,
  );

  function toggle() {
    setCollapsedStore(!collapsed);
  }

  // Logged out (e.g. /login, /signup): no chrome at all.
  if (!session) return null;

  return (
    <aside
      className={`hidden h-screen shrink-0 flex-col gap-6 border-r border-line bg-canvas py-5 md:flex ${
        collapsed ? "w-14 px-2" : "w-60 px-3"
      }`}
    >
      <div
        className={`flex items-center ${
          collapsed ? "flex-col gap-2 px-0" : "justify-between px-1"
        }`}
      >
        <Link
          href="/dashboard"
          aria-label="Lixto"
          className="flex items-center text-ink"
        >
          {collapsed ? <LogoMark className="h-6 w-6" /> : <Logo />}
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
        {COMPANY_ITEMS.map((item) => (
          <NavLink
            key={item.href}
            href={item.href}
            label={item.label}
            icon={item.icon}
            collapsed={collapsed}
          />
        ))}
        {session.role === "admin"
          ? COMPANY_ADMIN_ITEMS.map((item) => (
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
          {initials(session.name)}
        </span>
        {collapsed ? null : (
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[13px] font-medium text-ink">
              {session.name}
            </span>
            <span className="truncate text-[12px] text-ink-muted">
              {session.company}
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
