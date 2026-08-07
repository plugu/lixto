import type { Metadata } from "next";
import "./globals.css";
import { Sidebar } from "@/components/sidebar";

export const metadata: Metadata = {
  title: "Plataforma Licitante",
  description: "Dashboard de licitações públicas (PNCP)",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" className="h-full">
      <body className="flex h-full min-h-screen bg-white font-sans text-sm text-gray-900 antialiased">
        <Sidebar />
        <div className="min-w-0 flex-1">
          <main className="mx-auto max-w-[1200px] px-8 py-6">{children}</main>
        </div>
      </body>
    </html>
  );
}
