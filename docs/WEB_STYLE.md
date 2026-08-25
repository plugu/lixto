# Dashboard style guide (cycle 8 — "calm canvas, dense data")

Reference: `docs/WEB_DESIGN_DIRECTION.md` (source of truth for values).
Perplexity for chrome/home/empty states/auth (warm canvas, tone-separated
surfaces, one centered action, pill controls, whitespace); Attio for
lists/tables/filters/detail (compact icon+label sidebar with ⌘K, toolbar with
count badges, status as dot+text, dense rows, popovers). Light only, desktop
first. Tokens live in `web/app/globals.css` `@theme`.

## Tokens

| token | value | use |
|---|---|---|
| `--color-canvas` | `#FAF9F6` | page background |
| `--color-surface` | `#FFFFFF` | table body, inputs, popovers, hero box |
| `--color-surface-raised` | `#F3F1EC` | sidebar active, hover rows, toolbar pills, KPI tiles |
| `--color-ink` | `#1C1B18` | primary text, primary button bg |
| `--color-ink-muted` | `#6B6A64` | secondary text, labels, icons |
| `--color-ink-faint` | `#A3A19A` | placeholders, tertiary |
| `--color-line` | `#E8E6E0` | hairlines only |
| `--color-accent` | `#2F6BB3` | links, active nav text, count badges, focus ring |
| `--color-accent-soft` | `#E7EFF9` | accent chip bg, selected state bg |
| `--color-ok` / `--color-ok-soft` | `#2E8B57` / `#E6F4EC` | status Aberta, fit alto |
| `--color-warn` / `--color-warn-soft` | `#C8811A` / `#FBF0DF` | status Vai abrir, fit borderline |
| `--color-off` / `--color-off-soft` | `#8A8884` / `#EFEEEA` | status Fechada, sem análise |
| `--color-danger` | `#B4413C` | destructive, form errors |

**Legacy aliases** (kept valid until every page migrates in tickets 32–36 —
do not remove): `--color-background→canvas`, `--color-card→surface`,
`--color-muted→surface-raised`, `--color-muted-foreground→ink-muted`,
`--color-border→line`, `--color-foreground/--color-primary→ink`,
`--color-primary-foreground→surface`, `--color-met→ok`,
`--color-partial→warn`, `--color-unclear→off`.

Radius: `6px` (buttons, inputs, checkboxes, search box, toolbar buttons),
`10px` (popovers, hero box, tiles), pill `9999px` (chips, badges, count
pills — tags/indicators only, not interactive controls). `--radius-lg/md/sm`
alias to these for legacy usage.

Shadow: none for structure. Only `--shadow-popover` (popovers) and
`--shadow-card` (hero search box hairline + soft shadow). Do **not** put
`shadow-subtle` on plain cards — separation is by tone, not shadow.

## Type

- Display: **Instrument Serif** 400 (+ italic for emphasis words),
  `font-display` — titles, wordmark, big figures only. Never on table cells,
  nav or controls.
- Body: **Instrument Sans** 400/500/600, `font-sans` — everything else.
- Numbers use `font-variant-numeric: tabular-nums` (set globally on `body`;
  no monospace font).
- Scale: display-hero `text-[44px]/[48px]` (home question), display-xl
  `text-[30px]/[34px]` (page titles), display-lg `text-[28px]/[34px]`
  (detail objeto), display-md `text-[17px]/6` (section titles), display-num
  `text-[26px]–[34px]` (KPI/score); body `text-sm/5` (cells, forms), body-sm
  `text-[13px]/[18px]` (nav, toolbar, meta), caption `text-xs/4` (labels,
  uppercase `tracking-[0.08em]`).

## Chrome

- **Sidebar** (`components/sidebar.tsx`, client, `hidden md:flex`): 240px
  expanded / 56px collapsed (state in `localStorage` key `plic.sidebar`,
  guarded try/catch — never throws if storage is unavailable); bg `canvas`,
  right hairline `line`; nav item 32px tall, 13px, icon 18px; active =
  `bg-surface-raised` + `ink` text, **no left accent bar**; hover =
  `surface-raised` at ~60%. Logo row, `CommandSearch` trigger pill (⌘K),
  footer = avatar initials circle + nome + empresa + ghost "Sair" button.
  Returns `null` when logged out (no chrome on `/login`, `/signup`, …).
- **TopBar** (`components/ui/top-bar.tsx`, client, `md:hidden`): mobile
  header with a Menu button opening a slide-over that renders the same nav
  arrays exported from `sidebar.tsx` (`NAV_ITEMS`, `EMPRESA_ITEMS`,
  `EMPRESA_ADMIN_ITEMS`, `isActive`) — do not duplicate the nav list.
- **Layout** (`app/layout.tsx`): `main` = `relative z-[1] min-w-0 flex-1
  overflow-y-auto` > `div.mx-auto max-w-5xl px-8 py-10
  has-[.page-wide]:max-w-screen-2xl`. A page opts into the full
  `max-w-screen-2xl` width by adding a `page-wide` class to its outermost
  element — used by `/licitacoes` for its dense table.

## Kit usage (`web/components/ui/`)

- `Button`/`LinkButton`: `variant: primary|secondary|ghost|pill`,
  `size: sm|md`. `primary` = solid `ink` bg, `6px` radius, for the single
  main action per screen. `ghost` for low-emphasis actions (Sair, cancel).
  (`pill` variant name is legacy — it now renders `6px` radius like the rest.)
- `Input`/`Select`/`Label`/`Field`: 36px controls, 6px radius, focus ring
  `0 0 0 3px var(--color-accent-soft)` + 1px `accent` border. Wrap
  label+control+hint/error in `Field` for forms.
- `SearchBox`: GET form. `size="inline"` = 34px, `6px` radius, leading
  search icon (toolbar/list search). `size="hero"` = the composer: white
  box, 18px radius, hairline ring, auto-growing `<textarea rows={1}>` at
  17px (Enter submits, Shift+Enter newline), bottom row left slot =
  `children` (mode/scope pills), right = decorative mic icon + 36px ink
  `6px`-radius submit square.
  This is still degrading to plain `/licitacoes?q=` search — the NL agent
  ships in a later cycle.
- `Popover`: `<details>/<summary>` based (native no-JS fallback) +
  click-outside close. Use for Filtrar/Ordenar/Colunas toolbar menus.
- `Badge`/`StatusDot`: `Badge{tone: neutral|ok|warn|off|accent}` for fit and
  count pills; `StatusDot{tone, label}` = 8px dot + 13px text for licitação
  status (Aberta=ok, Vai abrir=warn, Fechada=off). Fit badge pattern: soft
  bg + strong text + score suffix (`· 82`).
- `Table`: sticky header (`bg-canvas`), no outer border/card wrapper, hairline
  rows (`border-line`). `density: default|compact` controls row height (44px
  / 36px) via a CSS custom property — set once on `<Table>`. `TR{href}`
  makes the whole row a click target (absolutely positioned `Link` inside a
  zero-width cell, row must not contain another interactive `href` link).
- `Toolbar`/`ToolbarButton{icon, label, count?}`: flex row of pill buttons;
  `count` renders as a small `accent-soft` badge (Attio style) — use for
  Filtrar/Ordenar/Colunas with active-filter counts.
- `EmptyState{icon, title, hint?, action?}`: calm, tone-separated
  (`surface-raised` block), centered text. **No dashed border.**
- `Section{title?, eyebrow?, actions?, children}`: no border/shadow —
  separation by spacing (`gap-4`) and the eyebrow/title pair only.
- `icons.tsx`: inline SVG, 1.5px stroke, round caps, `currentColor`; 16px in
  rows/toolbar, 20px in nav/empty states (pass `size`).
- `CommandSearch`: ⌘K global listener + a dialog with a single GET input
  submitting to `/licitacoes?q=`. Rendered inside the expanded sidebar.

## Table & toolbar rules

- No boxed card wrapper around tables — table sits directly on `canvas`.
- Header row: 36px, 13px medium `ink-muted`, **sentence case** (not
  uppercase caption).
- Row: 44px default / 36px compact; cell padding `12px 16px`; hairline
  bottom border only, no vertical borders.
- Row hover: `surface-raised`. Whole-row click via `TR href` — never nest a
  second `<a>`/`<Link>` inside a linked row.
- Toolbar sits above the table: `Filtrar · 2  Ordenar  Colunas`, each a
  `ToolbarButton`; active filters show as removable chips below.

## Form rules

- Label: `Label` component (12px, `ink-muted`, medium).
- Controls: `Input`/`Select`, 36px, 6px radius, `line` border, `accent`
  focus ring.
- Field spacing: `gap-1.5` inside a `Field`, `space-y-6` between field
  groups in a form.
- Inline error: `text-danger` (via `Field error`). Inline success: `text-ok`.

## pt-BR conventions

- All UI strings pt-BR. Dates `dd/mm/aaaa` (+ `HH:mm` when relevant);
  currency via `Intl.NumberFormat('pt-BR', {style:'currency', currency:'BRL'})`.
- Status values: "Aberta", "Vai abrir", "Fechada".
