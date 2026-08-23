import type { Metadata } from "next";
import { Instrument_Sans, Instrument_Serif } from "next/font/google";
import "./globals.css";
import { Sidebar } from "@/components/sidebar";
import { TopBar } from "@/components/ui/top-bar";
import { getSession } from "@/lib/auth";

const instrumentSans = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-sans-var",
});

const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-serif",
});

export const metadata: Metadata = {
  title: "Plataforma Licitante",
  description: "Dashboard de licitações públicas (PNCP)",
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
      className={`h-full ${instrumentSans.variable} ${instrumentSerif.variable}`}
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
