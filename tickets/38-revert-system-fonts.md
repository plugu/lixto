---
id: 38
status: done
model: haiku
depends_on: []
max_attempts: 2
files:
  - web/app/layout.tsx
  - web/app/globals.css
---
## Goal

Remove Google fonts (Hanken Grotesk, Bricolage Grotesque) and restore the Tailwind system-default sans stack across the web app.

## Context

Fonts were added in commit `59fdc91` via `next/font/google` in `web/app/layout.tsx`, exposed as CSS variables `--font-hanken` / `--font-bricolage`, consumed only in `web/app/globals.css` lines 24–25 (`--font-sans`, `--font-display` inside the Tailwind v4 `@theme` block). Many components use the `font-display` utility class — keep that utility working by remapping the token, do NOT touch those components.

Changes:

1. `web/app/layout.tsx`: delete the `next/font/google` import, the `hanken` and `bricolage` consts, and remove `${hanken.variable} ${bricolage.variable}` from the `<html>` className (keep `h-full`).
2. `web/app/globals.css`: replace the two token lines with:
   ```css
   --font-sans: ui-sans-serif, system-ui, sans-serif;
   --font-display: ui-sans-serif, system-ui, sans-serif;
   ```

## Checks (run in order — cheapest first)

1. `! grep -q 'next/font\|font-hanken\|font-bricolage' web/app/layout.tsx web/app/globals.css`
2. `cd web && npx eslint app/layout.tsx` (repo-wide `npm run lint` is red on pre-existing errors in multi-select.tsx/db.ts — do not fix those)
3. `cd web && npm run build`

## Done when

- App renders every page in the system default sans font; no Google-font code remains in the repo.
- `font-display` headings still render (mapped to the same system stack).

## Not included

- Any other visual change (colors, spacing, sizes, components).
- Removing the `font-display` utility classes from components.
- Cycle-8 redesign tickets 30–37.
