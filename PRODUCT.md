---
mode: mvp
routing_profile: cloud
parallel_default: sequential
---

# Nav consolidation: Painel absorbs Visão Geral

## What / why

Sidebar has two overview destinations — `/` ("Visão geral": search-hero + chips + stat tiles) and `/painel` ("Painel": charts dashboard, itself headed "Visão geral"). Redundant IA. Painel already has the stats; for now it becomes the single overview landing.

## Primary user story

Como licitante logado, eu acesso a raiz (`/`) ou clico em qualquer item de "Visão geral" e sou levado direto ao Painel — sem precisar decidir entre duas telas de overview.

## Scope

- Remove `/` ("Visão geral") item from `NAV_ITEMS` in `sidebar.tsx`.
- `/` route redirects (server-side) to `/painel`.
- Painel keeps its current content/heading as-is; it's now also the root landing.
- Any internal link/chip currently pointing at `/` for "overview" purposes points at `/painel` instead (audit `CHIPS`, breadcrumbs, logo link).

## Out of scope

- Redesigning Painel's content or layout.
- Removing the hero search UI's functionality — if it has value, it gets folded into Painel or another route in a later ticket, not decided here.
- Renaming "Painel" or its own "Visão geral" H1 — untouched.

## Success demo

Done when logged-in user hitting `/` lands on `/painel`, and sidebar shows one nav item ("Painel") instead of two.
