import type { Metadata } from "next";
import { Agente } from "@/components/marketing/agente";
import { ComoFunciona } from "@/components/marketing/como-funciona";
import { Faq } from "@/components/marketing/faq";
import { editorial } from "@/components/marketing/fonts";
import { Hero } from "@/components/marketing/hero";
import { Preco } from "@/components/marketing/preco";
import { Problema } from "@/components/marketing/problema";
import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";

const TITULO = "Lixto — agente autônomo de licitações";
const DESCRICAO =
  "O Lixto varre o PNCP duas vezes por dia, lê os editais e mede o encaixe com o perfil da sua empresa. Você entra só nas disputas que valem. Grátis durante o beta.";

export const metadata: Metadata = {
  title: TITULO,
  description: DESCRICAO,
  keywords: [
    "licitações",
    "PNCP",
    "editais",
    "agente de licitações",
    "licitações públicas",
  ],
  openGraph: {
    type: "website",
    locale: "pt_BR",
    siteName: "Lixto",
    title: TITULO,
    description: DESCRICAO,
  },
  twitter: {
    card: "summary_large_image",
    title: TITULO,
    description: DESCRICAO,
  },
};

export default function Home() {
  return (
    <div className={`${editorial.variable} flex-1 bg-canvas text-ink`}>
      <SiteHeader />
      <main>
        <Hero />
        <Problema />
        <Agente />
        <ComoFunciona />
        <Preco />
        <Faq />
      </main>
      <SiteFooter />
    </div>
  );
}
