---
id: 61
status: done
model: opus
depends_on: [60]
max_attempts: 3
files:
  - web/app/page.tsx
  - web/components/marketing/** (new)
  - web/app/globals.css (append-only)
---
## Goal
Replace the placeholder `/` with the full Liciplus landing page: PT-BR, senior-level visual design, pitching an autonomous licitação agent, CTA → `/signup`.

## Context
Read `PRODUCT.md` (repo root) — it defines brand, positioning, and the seven page sections (hero → problem → the agent → how it works → pricing "Grátis durante o beta" → FAQ → footer with `/login`). Positioning: the agent does the whole job — busca no PNCP (sync 2×/dia) → análise de editais (PDFs, requisitos, prazos) → fit com a empresa (score vs. perfil, CNAE, preço-alvo). Never promise autonomous proposal submission. Stack: Next 16 App Router, React 19, Tailwind v4 with `@theme` tokens in `web/app/globals.css` (canvas/surface/ink/accent teal `#0f766e`). Landing must feel distinct from the utilitarian dashboard — not a template. You may append marketing-scoped tokens to `globals.css` and add a display font via `next/font` in a module under `web/components/marketing/` (root layout loads Inter only; don't touch it). All components server-rendered unless interaction demands otherwise (FAQ accordion may use `<details>`). Responsive down to 360px; semantic landmarks; images/illustrations must be inline SVG or CSS — no external assets, no fabricated logos/testimonials/metrics.

## Checks (run in order — cheapest first)
1. `cd web && npm run lint`
2. `cd web && npm run build`
3. `cd web && npm run test`
4. `cd web && (PORT=3111 npm run start &) && sleep 4 && curl -s localhost:3111/ | grep -q 'href="/signup"' && curl -s localhost:3111/ | grep -qi 'Grátis durante o beta'; kill %1 2>/dev/null; true`

## Done when
- `/` renders the complete seven-section PT-BR landing, full-bleed, with ≥2 CTAs to `/signup` and a `/login` link in the footer.
- Page exports its own `metadata` (title "Liciplus — agente autônomo de licitações", description, OG tags).

## Not included
- Pricing plans/billing, blog, extra pages, analytics, A/B testing.
- Renaming app internals, dashboard chrome, or repo-wide brand strings.
- External images, fonts from files, testimonials, client logos, invented stats.
