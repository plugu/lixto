"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  COMPANY_ADMIN_ITEMS,
  COMPANY_ITEMS,
  isActive,
  NAV_ITEMS,
  type SidebarSession,
} from "@/components/sidebar";
import { Menu, X } from "./icons";

export function TopBar({ session }: { session: SidebarSession | null }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  if (!session) return null;

  return (
    <header className="flex h-12 items-center justify-between border-b border-line bg-canvas px-4 md:hidden">
      <Link href="/dashboard" className="font-display text-base italic text-ink">
        Lixto
      </Link>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Abrir menu"
        className="flex h-8 w-8 items-center justify-center rounded-md text-ink-muted hover:bg-surface-raised hover:text-ink"
      >
        <Menu size={20} />
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex">
          <div
            className="absolute inset-0 bg-ink/20"
            onClick={() => setOpen(false)}
          />
          <nav
            aria-label="Navegação principal"
            className="relative ml-auto flex h-full w-72 max-w-[80vw] flex-col gap-1 bg-canvas p-4 shadow-[0_8px_24px_rgba(28,27,24,.10)]"
          >
            <div className="mb-4 flex items-center justify-between">
              <span className="font-display text-base italic text-ink">Lixto</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Fechar menu"
                className="flex h-8 w-8 items-center justify-center rounded-md text-ink-muted hover:bg-surface-raised hover:text-ink"
              >
                <X size={18} />
              </button>
            </div>

            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className={`flex h-9 items-center gap-2.5 rounded-md px-3 text-[13px] font-medium ${
                  isActive(pathname, item.href)
                    ? "bg-surface-raised text-ink"
                    : "text-ink-muted hover:bg-surface-raised/60 hover:text-ink"
                }`}
              >
                <item.icon size={18} />
                {item.label}
              </Link>
            ))}

            <p className="mt-4 px-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-faint">
              Empresa
            </p>
            {COMPANY_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className={`flex h-9 items-center gap-2.5 rounded-md px-3 text-[13px] font-medium ${
                  isActive(pathname, item.href)
                    ? "bg-surface-raised text-ink"
                    : "text-ink-muted hover:bg-surface-raised/60 hover:text-ink"
                }`}
              >
                <item.icon size={18} />
                {item.label}
              </Link>
            ))}
            {session.role === "admin"
              ? COMPANY_ADMIN_ITEMS.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className={`flex h-9 items-center gap-2.5 rounded-md px-3 text-[13px] font-medium ${
                      isActive(pathname, item.href)
                        ? "bg-surface-raised text-ink"
                        : "text-ink-muted hover:bg-surface-raised/60 hover:text-ink"
                    }`}
                  >
                    <item.icon size={18} />
                    {item.label}
                  </Link>
                ))
              : null}

            <div className="flex-1" />
            <form action="/logout" method="post" className="px-1">
              <button
                type="submit"
                className="text-[13px] font-medium text-ink-muted hover:text-ink"
              >
                Sair
              </button>
            </form>
          </nav>
        </div>
      ) : null}
    </header>
  );
}
