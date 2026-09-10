import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { ViewTransitions } from "next-view-transitions";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { Toaster } from "@/components/ui/toaster";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans-var",
});

export const metadata: Metadata = {
  title: "Lixto",
  description: "Agente autônomo de licitações públicas (PNCP)",
  icons: { icon: "/favicon.svg" },
};

// Runs before hydration so the OS/`localStorage` theme choice is applied
// with zero flash. Reads the same "lixto.theme" key the toggle writes
// (light|dark|system); "system" needs no attribute — the CSS media query
// under `app/globals.css` already follows `prefers-color-scheme`.
const THEME_INIT_SCRIPT = `
(function () {
  try {
    var theme = window.localStorage.getItem("lixto.theme");
    if (theme === "light" || theme === "dark") {
      document.documentElement.dataset.theme = theme;
    }
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="pt-BR"
      className={`h-full ${inter.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="flex h-full min-h-screen flex-col bg-canvas font-sans text-sm text-ink antialiased">
        <ViewTransitions>
          <NuqsAdapter>{children}</NuqsAdapter>
          <Toaster />
        </ViewTransitions>
      </body>
    </html>
  );
}
