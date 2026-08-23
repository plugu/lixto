---
id: 31
status: doing
model: sonnet
depends_on: [30]
max_attempts: 3
files:
  - web/app/globals.css
  - web/app/layout.tsx
  - web/components/sidebar.tsx
  - web/components/ui/button.tsx
  - web/components/ui/input.tsx
  - web/components/ui/search-box.tsx
  - web/components/ui/popover.tsx
  - web/components/ui/badge.tsx
  - web/components/ui/status-dot.tsx
  - web/components/ui/table.tsx
  - web/components/ui/toolbar.tsx
  - web/components/ui/empty-state.tsx
  - web/components/ui/section.tsx
  - web/components/ui/icons.tsx
  - web/components/ui/top-bar.tsx
  - web/components/ui/command-search.tsx
  - docs/WEB_STYLE.md
---
## Goal
New tokens, a small `components/ui` kit, and the Attio-style sidebar/top-bar chrome — visible on every route immediately, with all existing pages still rendering (they keep their old markup until their own ticket).

## Context
Read `docs/design/cycle8-direction.md` first — it is the source of truth for every value below. Current `globals.css` has one `@theme` block (colors background/foreground/card/muted/muted-foreground/border/primary/primary-foreground/accent/met/partial/unclear, radius lg/md/sm, fonts `--font-sans`/`--font-display`, shadows subtle/card). Existing pages reference those token names — **keep every old token name as an alias** of the new palette so untouched pages don't break (e.g. `--color-card: var(--color-surface)`), and add the new names.

`layout.tsx` (server): currently fonts Hanken (`--font-hanken`) + Bricolage (`--font-bricolage`) — **replace with `Instrument_Serif` (weight "400", style ["normal","italic"], variable `--font-serif`) and `Instrument_Sans` (variable `--font-sans-var`) from `next/font/google`**; in `@theme`: `--font-sans: var(--font-sans-var), system-ui, sans-serif`, `--font-display: var(--font-serif), Georgia, serif`. `getSession()` → `<Sidebar session>`; main `relative z-[1] min-w-0 flex-1 overflow-y-auto` > `div.mx-auto max-w-5xl px-8 py-10 has-[.page-wide]:max-w-screen-2xl`. Keep `page-wide` mechanism; change the body background to the new canvas token; add `<TopBar>` (mobile only, `md:hidden`) and make sidebar `hidden md:flex`.

`sidebar.tsx` (client): NAV `/` Visão geral, `/licitacoes` Licitações; EMPRESA `/empresa` Minha empresa; admin-only `/empresa/usuarios`, `/empresa/documentos`; `isActive()` rule (`/licitacoes` also matches `/licitacao/*`); footer empresa/nome + POST `/logout` "Sair"; returns null without session. Rebuild as Attio-style: 240px, logo row, `CommandSearch` trigger (⌘K pill that opens a dialog with a single input submitting GET `/licitacoes?q=`), nav items icon+label 13px, active = `bg-surface-raised` + accent text (no left bar), add `/painel` "Painel" item under Visão geral, collapsible to 56px icon-only via a button (state in `localStorage` key `plic.sidebar`, guarded try/catch). Footer: avatar initials circle, nome, empresa, Sair as ghost button.

Kit (`components/ui/*.tsx`, all server-safe unless noted; Tailwind classes only, `cn()` helper inline via template strings — no clsx dep):
- `button.tsx`: `Button({variant: "primary"|"secondary"|"ghost"|"pill", size: "sm"|"md", asChild?: false, ...buttonProps})` and `LinkButton` (same variants, `href`).
- `input.tsx`: `Input`, `Select`, `Label`, `Field({label, hint?, error?, children})`.
- `search-box.tsx`: props `{name, placeholder, defaultValue?, action, size: "hero"|"inline", children?}` — renders a GET `<form>`. `inline`: 34px pill with leading search icon. `hero`: the composer from the approved mockup — white box radius 18px, hairline ring, `<textarea rows={1}>` styled as 17px text (Enter submits, Shift+Enter newline — small client wrapper with `onKeyDown`), bottom row: left slot renders `children` (pages pass mode/scope pills), right: decorative mic ghost icon (`aria-hidden`) + 36px `ink` circle submit button with up-arrow icon.
- `popover.tsx` (client): `Popover({trigger: ReactNode, children, align?})` using native `<details>`/`<summary>` for no-JS fallback + click-outside close via effect.
- `badge.tsx`: `Badge({tone: "neutral"|"ok"|"warn"|"off"|"accent", children})` pill; `status-dot.tsx`: `StatusDot({tone, label})` = 8px dot + 13px text.
- `table.tsx`: `Table`, `THead`, `TH({align?})`, `TBody`, `TR({href?})` (row-as-link via absolute inset `<Link>`), `TD({align?, numeric?})`, `density: "default"|"compact"` prop on `Table`. Sticky header, no outer border, hairline rows using `line` token.
- `toolbar.tsx`: `Toolbar` flex row + `ToolbarButton({icon, label, count?})` (count renders as tiny accent badge, Attio style).
- `empty-state.tsx`: `EmptyState({icon, title, hint?, action?})` — Perplexity calm style, no dashed border.
- `section.tsx`: `Section({title?, eyebrow?, actions?, children})` — tone-separated block, no border/shadow.
- `icons.tsx`: inline SVG set, 1.5px stroke, `size` prop: Search, Plus, Filter, Sort, Columns, Chevron, Check, X, Home, List, Building, Users, FileText, Chart, LogOut, Menu, Sidebar, Arrow, Dot, Download, Upload, Calendar, Tag, Link, Alert.
- `top-bar.tsx` (client): mobile header with Menu button toggling a slide-over that renders the same nav list (import nav arrays from `sidebar.tsx` — export them).
- `command-search.tsx` (client): ⌘K listener + dialog.

`docs/WEB_STYLE.md`: rewrite fully for the new system (tokens, type, chrome, kit usage, table/toolbar rules, form rules, pt-BR conventions). Remove obsolete rules (`shadow-subtle` on cards, left-bar active state, dashed empty state).

## Checks (run in order — cheapest first)
1. `cd web && npx tsc --noEmit`
2. `cd web && npx vitest run`
3. `cd web && npm run build`
4. `cd web && (npm run start -- -p 3100 &) && sleep 5 && curl -s -c /tmp/c.txt localhost:3100/login | grep -q 'font-display' && pkill -f "next-server"` (login is public; verifies new layout renders)

## Done when
- All routes render with the new chrome; old pages visually unchanged inside (aliases hold); kit exports compile; style doc rewritten.

## Not included
- Do not modify any `page.tsx` or non-kit component (charts, filters, forms, badges) — those are tickets 32–36. No dark mode. No new deps.
