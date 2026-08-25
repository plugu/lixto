---
mode: mvp
routing_profile: cloud
parallel_default: sequential
---

# Lixto — marketing website

## What / why
Plataforma-licitante has a working product (PNCP mirror, AI fit-triage against the company profile, CNAE matching, preço-alvo, multi-tenant dashboard) but no public face. Competitors lisix.com.br and licinexus.com.br sell search + alerts over licitações — tools you still have to operate. We launch the public brand **Lixto** positioned as an **autonomous licitação agent**: it does the whole job for you — hunts opportunities across the PNCP, reads and analyzes each edital, and scores the fit with your company. You don't search, filter, or triage; the agent works daily and hands you only the disputes worth entering. Competitors sell a search tool; we sell a worker.

The site lives inside the existing `web/` Next.js app as the public `/` route (plus anchor sections), sharing the deploy and linking directly into the existing `/signup` (empresa + CNPJ lookup) and `/login` flows.

## Primary user story
As an SME owner or bid manager drowning in hundreds of daily editais, I land on Lixto, immediately understand that an autonomous agent will do the searching, edital analysis, and fit assessment for me, and sign up self-serve so that I only spend time on opportunities I can actually win.

## Site structure (one page, scrolling)
1. **Hero** — headline on the autonomous-agent promise ("seu agente de licitações trabalha por você"), CTA → `/signup`.
2. **Problem** — doing licitações by hand: volume, missed deadlines, unreadable PDF editais, hours triaging.
3. **The agent** — what it does end-to-end: busca (PNCP-wide, sync 2×/dia) → análise (reads edital PDFs, requirements, prazos) → fit (score against company profile, CNAE match, preço-alvo).
4. **How it works** — 3 steps: cadastre sua empresa (CNPJ lookup) → o agente trabalha todo dia → você recebe só o que vale disputar.
5. **Pricing block** — "Grátis durante o beta", single card, CTA → `/signup`.
6. **FAQ** — data source (PNCP), what the agent reads, security/multi-tenant.
7. **Footer** — login link, contact.

Language: PT-BR throughout. Design: senior-level visual quality, distinct from the utilitarian dashboard; must not read as a template.

## Out of scope
- Separate marketing repo/domain split (stays in `web/`)
- Pricing plans/billing (free beta only)
- Blog, about page, multi-page site
- SEO tooling beyond basic metadata/OG tags, analytics, A/B testing
- Demo videos, real testimonials/logos (no fabricated social proof)
- Renaming the repo/app internals to Lixto (brand is site-level copy only)
- Agent actually submitting proposals (product analyzes and recommends; site must not overpromise autonomous bidding)

## Success demo
Done when I can open the root URL, scroll a polished PT-BR landing page that pitches Lixto as the autonomous licitação agent, click the CTA, and land on the existing `/signup` form.
