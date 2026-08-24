---
id: 39
status: done
model: haiku
depends_on: []
max_attempts: 2
files: [web/app/layout.tsx, web/app/globals.css]
---
## Goal
Swap the app to the Attio-style look: Inter font everywhere and a cool neutral default palette, by editing only `web/app/layout.tsx` and `web/app/globals.css`.

## Context
Tailwind v4; all colors come from CSS vars in the `@theme` block of `web/app/globals.css`. Fonts load in `web/app/layout.tsx` via `next/font/google` (currently Instrument_Sans → `--font-sans-var`, Instrument_Serif → `--font-serif`).

Changes:
1. `layout.tsx`: replace both font imports with a single `Inter` import: `const inter = Inter({ subsets: ["latin"], variable: "--font-sans-var" })`. On `<html>` use `className={`h-full ${inter.variable}`}`. Delete the Instrument constants.
2. `globals.css`: keep the `@theme` structure and every var NAME identical (legacy aliases too). Change only these values:
   - `--color-canvas: #fafafa;` `--color-surface: #ffffff;` `--color-surface-raised: #f4f4f5;`
   - `--color-ink: #18181b;` `--color-ink-muted: #6f6f78;` `--color-ink-faint: #a1a1aa;`
   - `--color-line: #e4e4e7;`
   - `--color-accent: #2563eb;` `--color-accent-soft: #eff4fe;`
   - `--color-ok: #10a35f;` `--color-ok-soft: #e6f6ee;`
   - `--color-warn: #d97917;` `--color-warn-soft: #fdf1e0;`
   - `--color-off: #8b8b92;` `--color-off-soft: #f0f0f2;`
   - `--color-danger: #dc3f38;`
   - `--font-display: var(--font-sans-var), system-ui, sans-serif;` (serif gone; headings use the same sans, Attio-style)
   - shadow rgba base `28, 27, 24` → `24, 24, 27` in all three shadows.
3. Update the header comment in `globals.css` to say "Attio-style cool neutrals (prototype)".

## Checks (run in order — cheapest first)
1. `cd web && npm run lint`
2. `cd web && npm run build`

## Done when
- `grep -c "Instrument" web/app/layout.tsx` returns 0; Inter is the only Google font.
- All `@theme` var names unchanged; values match the list above; build passes.

## Not included
- No component/markup edits anywhere else. No dark mode. No new tokens, no removed tokens. The palette widget (ticket 40) is separate.
