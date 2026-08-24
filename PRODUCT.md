---
mode: mvp
routing_profile: cloud
parallel_default: sequential
---

# plataforma-licitante — responsive layout (cycle 9)

## What / why

The web app is designed against 1440×900 desktop artboards: fixed `max-w-5xl` content column, persistent sidebar, dense data tables, and charts sized for wide viewports. On a phone it breaks — tables overflow, filters cramp, the sidebar eats the screen. The operator needs to check licitações away from the desk, so every screen must work down to a ~375px phone.

## Primary user story

As the operator, I open any page of the web app on my phone (~375px) and can read, navigate, and act — browse and filter the licitações list, open a licitação detail with its análise and itens, check the dashboard, and manage empresa admin pages — so that I'm not chained to a desktop to track licitações.

## Scope

- **Floor: 375px.** Everything works from 375px up to current desktop rendering, which must not regress.
- **Navigation:** sidebar becomes a mobile drawer (hamburger) below `md`; current desktop sidebar untouched.
- **Tables → cards on phone.** All dense tables (licitações list, itens, usuários, documentos empresa, documentos list) reflow to stacked cards below `md`. Same data, prioritized fields; no column is silently lost — secondary fields may collapse into the card body.
- **Filters/chips:** licitações filter bar wraps or collapses into a compact control usable one-handed on phone.
- **Dashboard/painel charts:** resize fluidly; no fixed pixel widths; legends/labels stay legible at 375px.
- **Forms** (empresa, signup, login, convite, upload): single-column on phone, touch-friendly targets.
- **No horizontal page scroll on any screen at 375px** — overflow only inside deliberate scroll containers.

## Out of scope

- Visual redesign — cycle 8 "calm canvas, dense data" tokens, palette, and typography stay as-is. (Attio restyle idea superseded; tickets 39–40 remain on disk, not part of this cycle.)
- Dark mode.
- Native app, PWA/offline, touch gestures beyond scroll/tap.
- New features, backend, queries, auth changes.
- Pixel-perfect tablet designs — tablet inherits whichever side of the breakpoint fits; only phone and desktop are explicitly designed.

## Success demo

Done when I can open dashboard, licitações list (with filters), a licitação detail, and the empresa pages in a 375px viewport and use every one — drawer nav, card-reflowed tables, fluid charts, no horizontal page scroll — while desktop rendering is unchanged.
