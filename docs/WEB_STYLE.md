# Dashboard style guide (cycle 2 — revised)

Reference: the `~/dev/resume-copilot` admin (its tokens ported verbatim). Clean,
flat, light, calm. Desktop-first. Tokens live in `web/app/globals.css` `@theme`.

## Tokens

- Canvas `--color-background` hsl(220 20% 97%); surfaces `--color-card` white.
- Ink `--color-foreground` hsl(216 55% 14%) (deep navy); muted text
  `--color-muted-foreground`; fills `--color-muted`; hairlines `--color-border`.
- `--color-primary` = near-black navy (buttons, active nav bar); links/accents
  `--color-accent` (blue).
- Status colors (from the reference's verdict palette): `--color-met` green =
  Aberta, `--color-partial` amber = Vai abrir, `--color-unclear` slate = Fechada.
- Radius: lg 0.7rem. Shadows: `shadow-subtle` on cards/controls only.

## Type

- Body: Hanken Grotesk (`font-sans`); page titles: Bricolage Grotesque
  (`font-display text-2xl font-bold tracking-tight`); base `text-sm`.

## Layout

- Sidebar: `w-64 sticky h-screen border-r border-border bg-card/80
  backdrop-blur-sm px-5 py-6`, eyebrow label (uppercase, tracking-[0.18em],
  0.65rem), active nav item = `bg-muted` + 3px `bg-primary` left bar
  (rounded-r-full).
- Main: `max-w-5xl mx-auto px-8 py-10`.

## Components

- Tables: `overflow-hidden rounded-lg border border-border bg-card
  shadow-subtle`; thead `bg-muted/50`, cells `px-4 py-3`, th `font-medium
  text-muted-foreground` (sentence case); tbody `divide-y divide-border`, rows
  `hover:bg-muted/30 transition-colors`.
- Badges: `rounded-full border px-2.5 py-0.5 text-xs font-semibold self-start`,
  soft bg (`bg-met/10 border-met/30 text-met` pattern).
- Primary button: `bg-primary text-primary-foreground rounded-lg font-semibold
  shadow-sm hover:bg-primary/90 active:scale-[0.98] transition-all duration-150`.
- Controls: `rounded-lg border-border bg-card shadow-subtle
  focus-visible:ring-2 focus-visible:ring-accent/40`; cap select width
  (`max-w-56`) — option text can be long.
- Empty state: `min-h-[40vh] border border-dashed rounded-lg` centered muted text.

## pt-BR conventions

- All UI strings pt-BR. Dates `dd/mm/aaaa` (+ `HH:mm` when relevant); currency
  via `Intl.NumberFormat('pt-BR', {style:'currency', currency:'BRL'})`.
- Status values: "Aberta", "Vai abrir", "Fechada".
