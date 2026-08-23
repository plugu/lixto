# Cycle 8 — visual direction: "calm canvas, dense data"

Perplexity for chrome, home, empty states and auth (warm canvas, tone-separated surfaces, one centered action, pill controls, whitespace). Attio for lists, tables, filters and detail (compact icon+label sidebar with ⌘K, toolbar with count badges, status as dot+text, dense rows, popovers). Light only.

## Tokens (Tailwind v4 `@theme`, `web/app/globals.css`)

| token | value | use |
|---|---|---|
| `--color-canvas` | `#FAF9F6` | page background (warm off-white) |
| `--color-surface` | `#FFFFFF` | table body, inputs, popovers, hero box |
| `--color-surface-raised` | `#F3F1EC` | sidebar active, hover rows, toolbar pills, KPI tiles, sections |
| `--color-ink` | `#1C1B18` | primary text, primary button bg |
| `--color-ink-muted` | `#6B6A64` | secondary text, labels, icons |
| `--color-ink-faint` | `#A3A19A` | placeholders, tertiary |
| `--color-line` | `#E8E6E0` | hairlines only (table rows, sidebar edge) |
| `--color-accent` | `#2F6BB3` | links, active nav text, count badges, focus ring, chart primary |
| `--color-accent-soft` | `#E7EFF9` | accent chip bg, selected state bg |
| `--color-ok` | `#2E8B57` | status Aberta, fit alto, success |
| `--color-ok-soft` | `#E6F4EC` | |
| `--color-warn` | `#C8811A` | status Vai abrir, fit borderline, validade near |
| `--color-warn-soft` | `#FBF0DF` | |
| `--color-off` | `#8A8884` | status Fechada, vencido, sem análise |
| `--color-off-soft` | `#EFEEEA` | |
| `--color-danger` | `#B4413C` | destructive, form errors |

Legacy aliases kept until every page migrates: `background→canvas`, `card→surface`, `muted→surface-raised`, `muted-foreground→ink-muted`, `border→line`, `foreground/primary→ink`, `primary-foreground→surface`, `met→ok`, `partial→warn`, `unclear→off`.

**Type** — display: **Instrument Serif** 400 (+ italic for emphasis words, `--font-display`), body: **Instrument Sans** 400/500/600 (`--font-sans`). Both Google Fonts via `next/font/google` (replaces Bricolage/Hanken — v2 after review). Numbers: `font-variant-numeric: tabular-nums` (no mono font). Serif is for titles, wordmark, big figures only — never for table cells, nav or controls.
Scale: display-hero 44/48 (home question), display-xl 30/34 (page titles), display-lg 28/34 (detail objeto), display-md 17/24 (section titles), display-num 26–34 (KPI/score); body 14/20 regular (cells, forms), body-sm 13/18 (nav, toolbar, meta), caption 12/16 (labels, eyebrows uppercase `tracking-[0.08em]`).

**Home hero (v2)** — conversational composer, not a search box: serif question headline ("O que você quer saber *hoje*?"), multi-line input, mode pill "Agente" + scope pill "Abertas", mic + send; four example-question chips below. Cycle 8 ships this as UI over the existing `/licitacoes?q=` search; the NL→DB agent is a separate cycle (see PRODUCT out-of-scope) — the composer must degrade to plain search until then.

**Radius** — pill `9999px` (buttons, chips, search box, badges), `10px` (popovers, hero box, tiles), `6px` (inputs, checkboxes).
**Spacing** — 4-pt rhythm; page gutter 32px; section gap 40px; toolbar gap 8px.
**Shadow** — none for structure. Only: popover `0 8px 24px rgba(28,27,24,.10)`, hero search box `0 1px 2px rgba(28,27,24,.06), 0 0 0 1px var(--color-line)`.
**Borders** — no boxed cards. Separation by tone (`surface` on `canvas`) and hairlines (`line`) inside lists.
**Icons** — inline SVG, 1.5px stroke, round caps, 16px in rows/toolbar, 20px in nav/empty states, `currentColor`.
**Sidebar** — 240px expanded / 56px collapsed; bg `canvas`, right hairline `line`; item 32px tall, 13px, icon 18px; active: `surface-raised` bg + `ink` text (no accent bar); hover: `surface-raised` at 60%.
**Density** — table row 44px default / 36px compact; cell padding 12px 16px; header 36px, 12px caption uppercase? No — header 13px medium `ink-muted`, sentence case.
**Controls** — button md 36px, sm 30px; input 36px; focus ring `0 0 0 3px var(--color-accent-soft)` + `accent` 1px.
**Status dot** — 8px circle + 13px text: Aberta=ok, Vai abrir=warn, Fechada=off. **Fit badge** — pill 24px, soft bg + strong text: fit=ok, borderline=warn, no_fit=off; score suffix `· 82`.

## Component kit (`web/components/ui/`)

| file | exports / props |
|---|---|
| `button.tsx` | `Button{variant: primary\|secondary\|ghost\|pill, size: sm\|md}`, `LinkButton{href, same}` |
| `input.tsx` | `Input`, `Select`, `Label`, `Field{label, hint?, error?, children}` |
| `search-box.tsx` | `SearchBox{name, placeholder, defaultValue?, action, size: hero\|inline}` — GET form |
| `popover.tsx` | `Popover{trigger, children, align?}` (client) |
| `badge.tsx` / `status-dot.tsx` | `Badge{tone: neutral\|ok\|warn\|off\|accent}`, `StatusDot{tone, label}` |
| `table.tsx` | `Table{density}`, `THead`, `TH{align?}`, `TBody`, `TR{href?}`, `TD{align?, numeric?}` |
| `toolbar.tsx` | `Toolbar`, `ToolbarButton{icon, label, count?}` |
| `empty-state.tsx` | `EmptyState{icon, title, hint?, action?}` |
| `section.tsx` | `Section{title?, eyebrow?, actions?, children}` |
| `icons.tsx` | `Icon` set (Search, Plus, Filter, Sort, Columns, Chevron, Check, X, Home, List, Building, Users, FileText, Chart, LogOut, Menu, Sidebar, Arrow, Download, Upload, Calendar, Tag, Link, Alert) `{size?}` |
| `top-bar.tsx` / `command-search.tsx` | mobile header; ⌘K dialog → GET `/licitacoes?q=` |

## Screens (canvas artboards, 1440×900)

- **Home** — sidebar + centered wordmark, hero search, 4 pill chips, 3 KPI tiles, ghost link to `/painel`.
- **Licitações** — header (title + count + inline search), toolbar (Filtrar·2, Ordenar, Colunas), chips row, dense table (Objeto/Modalidade/Status/Fit/Valor/Encerramento), pagination.
- **Detalhe** — back link, objeto display-lg, meta line, badges, facts grid, 2-col body: Itens + Documentos | sticky Análise.

canvas: https://claude.ai/code/artifact/2d2def4e-ab1f-4066-b7d2-4f63331b183a
approved: 2026-08-23 (v2 — Instrument Serif/Sans, agent composer hero; NL agent deferred to cycle 9)
