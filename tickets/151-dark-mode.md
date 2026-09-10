---
id: 151
status: done
model: sonnet
depends_on: [150]
max_attempts: 3
files:
  - web/app/globals.css
  - web/app/layout.tsx
  - web/components/ui/theme-toggle.tsx
  - web/components/sidebar.tsx
  - web/components/charts/bar-list.tsx
  - web/components/charts/daily-line.tsx
  - web/components/charts/status-stack.tsx
  - web/components/charts/stat-tile.tsx
  - docs/WEB_STYLE.md
---
## Goal
The app follows the OS colour scheme and offers a manual light/dark/system toggle, using the existing semantic tokens, and `docs/WEB_STYLE.md` stops describing a palette the code no longer ships.

## Context
Tokens live in `globals.css` `@theme` (Slate: canvas `#f8fafc`, ink `#0f172a`, accent `#0f766e`, …). `docs/WEB_STYLE.md` still lists the warm cycle-8 palette (`#FAF9F6`, `#2F6BB3`) — update its token table to the Slate values and add the dark column. Charts use token classes only (no raw hex — verified).

Work:
1. `globals.css`: keep light values on `:root` via `@theme`; add a dark set under `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --color-canvas:#0b1220; --color-surface:#111827; --color-surface-raised:#1f2937; --color-ink:#e5e7eb; --color-ink-muted:#9ca3af; --color-ink-faint:#6b7280; --color-line:#273244; --color-accent:#2dd4bf; --color-accent-soft:#134e4a; --color-ok:#4ade80; --color-ok-soft:#14532d; --color-warn:#fbbf24; --color-warn-soft:#78350f; --color-off:#9ca3af; --color-off-soft:#1f2937; --color-danger:#f87171; } }` and the same block under `:root[data-theme="dark"]`. Tailwind v4 `@theme` vars are plain CSS custom properties, so overriding them on `:root` works; verify contrast ≥4.5:1 for ink/ink-muted on canvas/surface (adjust values if not). Add `color-scheme: light dark` on `:root`.
2. `layout.tsx`: inline `<script>` before hydration that reads `localStorage["lixto.theme"]` (`light|dark|system`) and sets `data-theme` on `<html>` to avoid flash; `suppressHydrationWarning` on `<html>`.
3. `theme-toggle.tsx` (client): three-state segmented control (icons from `@/components/ui/icons` — add `Sun`/`Moon`/`Monitor` there only if missing, otherwise reuse), writes the key and `data-theme`. Mount in the sidebar footer next to the avatar (expanded) or as a single icon button (collapsed).
4. Marketing tokens (`--color-night*`, `--color-mint`, `--color-sand*`) untouched; landing page is out of scope.

## Checks (run in order — cheapest first)
1. `cd web && npm run lint`
2. `cd web && npm run build`
3. `cd web && npm test`
4. `cd web && grep -q 'data-theme="dark"' app/globals.css && grep -q 'prefers-color-scheme: dark' app/globals.css`

## Done when
- With macOS in dark mode the app renders dark tokens with no flash on reload; the toggle overrides and persists; charts and badges remain legible.

## Not included
- Dark landing page; per-page theme overrides; email templates.
