---
mode: prototype
routing_profile: cloud
parallel_default: sequential
---

# plataforma-licitante — revert layout fonts to system default

## What / why

Commit `59fdc91` introduced Hanken Grotesk (body) and Bricolage Grotesque (display) via `next/font/google` in `web/app/layout.tsx`. We want the typography from before that change back: the plain Tailwind default sans stack (system fonts), no Google fonts loaded. Everything else about the current design (colors, spacing, layout) stays as is.

## Primary user story

As the operator, I open any page of the web app and read it in the default system sans font, with no custom webfonts downloaded, so the UI feels like it did pre-`59fdc91` typographically.

## Out of scope

- Any other visual change (colors, spacing, sidebar, components).
- Touching the cycle-8 redesign plan/tickets (30–37) — separate effort; its spec lives in git history at `54c9555`.
- Removing/altering `globals.css` rules unrelated to font-family variables.
- Backend, queries, auth, tests semantics.

## Success demo

Done when I can run the app, see every page render in the system default sans (no `--font-hanken`/`--font-bricolage`, no `next/font` requests in the network tab), and `npm run build` passes.
