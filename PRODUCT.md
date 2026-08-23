---
mode: mvp
routing_profile: cloud
parallel_default: sequential
worktree: required
---

# plataforma-licitante — redesign "calm canvas, dense data" (cycle 8)

## What / why

The UI grew route by route (licitações, detalhe, login/signup, empresa, documentos, usuários) on a generic card-and-border look. A full presentation-layer redesign gives it one coherent flat identity, modelled on two references: **Perplexity** (warm off-white canvas, surfaces separated by tone not borders, one centered hero action, pill controls, generous whitespace) for chrome, home and empty states; **Attio** (compact icon+label sidebar with ⌘K search, toolbar row Filtrar · Ordenar · Colunas with count badges, status as colored dot + text, popover panels, neutral grays + one accent, dense rows) for lists, tables, filters and detail. Existing behavior, queries, auth and the 312-test suite stay untouched.

## Primary user story

As an operator, I land on `/` and see a centered search box with quick-filter chips and a small KPI strip; I search or click a chip and arrive at `/licitacoes`, a dense table with a toolbar (filter/sort/columns), status dots and fit badges; row click opens a detail page laid out in the same system; empresa/usuários/documentos/login/signup share the identical chrome and components — everything reads as one product.

## Scope

- **Design tokens** (`globals.css`, Tailwind v4 `@theme`): warm neutral palette, one accent, status/fit semantic colors, type scale (display + body sans), spacing/radius, focus rings. Document in `docs/WEB_STYLE.md` (rewrite).
- **Component kit** (`web/components/ui/`): Button (primary/secondary/ghost/pill), Input, SearchBox, Popover, Badge/StatusDot, Table (sticky header, density), Toolbar, Sidebar, TopBar (mobile), EmptyState, Card-less "Section". Inline SVG icon set. No new deps.
- **Chrome:** Attio-style sidebar (logo, ⌘K search, nav, empresa/user footer), collapsible; mobile → top bar.
- **Home `/`:** Perplexity-style hero (search + chips: Abertas hoje · Meu setor · Fit alto · Encerrando em 7 dias) + KPI strip; current charts move to `/painel`.
- **`/licitacoes`:** toolbar with Filtrar/Ordenar/Colunas popovers (counts as badges), existing multi-select filters re-skinned inside; table restyle; fit/status as dot+label; pagination/footer.
- **`/licitacao/[id]`:** header (objeto, órgão, status, fit), two-column body (itens/documentos · análise panel) in the new system.
- **Auth + empresa pages:** login/signup/convite centered Perplexity-style forms; empresa/usuários/documentos as Attio-style settings pages with the same table kit.
- **Process:** first ticket produces token sheet + static mockups of home and `/licitacoes` for approval before touching pages.

## Out of scope

- Dark mode; new UI/icon libraries (no shadcn); kanban view.
- Any change to queries, filters semantics, auth, tenant logic, agents, sync.
- Pixel-designed mobile (must be usable, not designed).
- New features (favorites, notifications, column persistence per user).

## Success demo

Done when I can walk `/` → search → `/licitacoes` → detail → `/empresa` → `/login` and every screen uses the same tokens and components, the old card/border look is gone, `npm run build` and `vitest` (312) pass, and the site deploys via the existing pipeline.
