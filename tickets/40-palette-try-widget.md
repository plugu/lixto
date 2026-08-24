---
id: 40
status: done
model: sonnet
depends_on: [39]
max_attempts: 2
files: [web/components/palette-widget.tsx, web/app/layout.tsx]
---
## Goal
Floating throwaway widget (bottom-right, every page) that live-switches the whole UI between 4 candidate palettes by overriding the `@theme` CSS vars on `document.documentElement`.

## Context
After ticket 39, all colors flow from CSS vars defined in `@theme` in `web/app/globals.css` (`--color-canvas`, `--color-surface`, `--color-surface-raised`, `--color-ink`, `--color-ink-muted`, `--color-ink-faint`, `--color-line`, `--color-accent`, `--color-accent-soft`, `--color-ok`, `--color-ok-soft`, `--color-warn`, `--color-warn-soft`, `--color-off`, `--color-off-soft`, `--color-danger`). Overriding these via `el.style.setProperty(name, value)` restyles everything instantly.

Build `web/components/palette-widget.tsx` (`"use client"`):
- `const PALETTES: Record<string, Record<string, string>>` with 4 entries:
  1. `"Attio Cool"` — empty object `{}` (the new defaults from ticket 39).
  2. `"Calm Warm"` (cycle-8): canvas `#faf9f6`, surface `#ffffff`, surface-raised `#f3f1ec`, ink `#1c1b18`, ink-muted `#6b6a64`, ink-faint `#a3a19a`, line `#e8e6e0`, accent `#2f6bb3`, accent-soft `#e7eff9`, ok `#2e8b57`, ok-soft `#e6f4ec`, warn `#c8811a`, warn-soft `#fbf0df`, off `#8a8884`, off-soft `#efeeea`, danger `#b4413c`.
  3. `"Slate"`: canvas `#f8fafc`, surface `#ffffff`, surface-raised `#f1f5f9`, ink `#0f172a`, ink-muted `#64748b`, ink-faint `#94a3b8`, line `#e2e8f0`, accent `#0f766e`, accent-soft `#e5f4f2`, ok `#15803d`, ok-soft `#e8f5ec`, warn `#b45309`, warn-soft `#faf0e2`, off `#8a94a6`, off-soft `#eef1f5`, danger `#be3536`.
  4. `"Graphite"`: canvas `#f6f6f7`, surface `#ffffff`, surface-raised `#ececee`, ink `#141417`, ink-muted `#6e6e76`, ink-faint `#a5a5ad`, line `#e3e3e6`, accent `#5b5bd6`, accent-soft `#ececfb`, ok `#1f9d61`, ok-soft `#e6f5ed`, warn `#cf7c10`, warn-soft `#fbf1de`, off `#89898f`, off-soft `#efeff1`, danger `#d43d3a`.
- Apply: on select, first clear every var from the union of all palette keys (`removeProperty`), then `setProperty` each entry of the chosen palette onto `document.documentElement.style`. Persist name in `localStorage` key `plic.palette`; re-apply in a `useEffect` on mount (flash on load is acceptable — prototype).
- UI: fixed `bottom-4 right-4 z-50` small card (`bg-surface border border-line rounded-lg shadow-popover p-2 text-xs`), one button per palette with a color-dot preview (inline-style swatch of canvas/accent/ink), active one highlighted. Collapse to a single 🎨 button that toggles the list open/closed.
- Mount: in `web/app/layout.tsx`, `import { PaletteWidget } from "@/components/palette-widget"` and render `<PaletteWidget />` just before `</body>`. Touch nothing else in layout.

## Checks (run in order — cheapest first)
1. `cd web && npm run lint`
2. `cd web && npm run build`

## Done when
- Widget visible on every page; clicking a palette instantly recolors the UI; choice survives reload.

## Not included
- No server persistence, no dark mode, no theming abstraction, no font switching, no edits to globals.css or other components. Widget is disposable — keep it self-contained in one file.
