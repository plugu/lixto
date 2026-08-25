import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans-var",
});

export const metadata: Metadata = {
  title: "Plataforma Licitante",
  description: "Dashboard de licitações públicas (PNCP)",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="pt-BR"
      className={`h-full ${inter.variable}`}
    >
      <body className="flex h-full min-h-screen flex-col bg-canvas font-sans text-sm text-ink antialiased">
        {children}
      </body>
    </html>
  );
}
