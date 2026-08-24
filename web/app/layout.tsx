import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Sidebar } from "@/components/sidebar";
import { TopBar } from "@/components/ui/top-bar";
import { getSession } from "@/lib/auth";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans-var",
});

export const metadata: Metadata = {
  title: "Plataforma Licitante",
  description: "Dashboard de licitações públicas (PNCP)",
  icons: { icon: "/favicon.svg" },
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Sidebar chrome only exists for logged-in users; /login & friends render
  // the bare card. Cookie -> DB lookup happens once here, per request.
  const session = await getSession();

  const sidebarSession = session
    ? {
        nome: session.usuario.nome,
        empresa: session.empresa.nomeFantasia ?? session.empresa.razaoSocial,
        role: session.usuario.role,
      }
    : null;

  return (
    <html
      lang="pt-BR"
      className={`h-full ${inter.variable}`}
    >
      <body className="flex h-full min-h-screen flex-col bg-canvas font-sans text-sm text-ink antialiased md:flex-row">
        <TopBar session={sidebarSession} />
        <Sidebar session={sidebarSession} />
        <main className="relative z-[1] min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-5xl px-8 py-10 has-[.page-wide]:max-w-screen-2xl">
            {children}
          </div>
        </main>
      </body>
    </html>
  );
}
