import type { Metadata } from "next";
import "./globals.css";
import { Sidebar } from "@/components/sidebar";
import { getSession } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Plataforma Licitante",
  description: "Dashboard de licitações públicas (PNCP)",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Sidebar chrome only exists for logged-in users; /login & friends render
  // the bare card. Cookie -> DB lookup happens once here, per request.
  const session = await getSession();

  return (
    <html lang="pt-BR" className="h-full">
      <body className="flex h-full min-h-screen bg-background font-sans text-sm text-foreground antialiased">
        <Sidebar
          session={
            session
              ? {
                  nome: session.usuario.nome,
                  empresa:
                    session.empresa.nomeFantasia ?? session.empresa.razaoSocial,
                  role: session.usuario.role,
                }
              : null
          }
        />
        <main className="relative z-[1] min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-5xl px-8 py-10 has-[.page-wide]:max-w-screen-2xl">
            {children}
          </div>
        </main>
      </body>
    </html>
  );
}
