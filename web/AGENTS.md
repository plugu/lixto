<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Lixto rules (cycle 27+)

1. **URL-state binding**: Filters on `/procurements`, `/radar`, `/opportunities` are driven by URL state via `nuqs` (pill-tabs) and custom URL builders (`lib/procurement-url.ts`, `lib/radar-url.ts`). Never add a `<form method=GET>` for filters; use the URL-state hooks instead (`useProcurementFilters`, `useRadarFilters`). Apply filters on `onChange` via `useTransition(router.push(...))` — no "Aplicar" button, no page remount.

2. **Router transitions**: Always wrap `router.push()` in `startTransition()` (imported from `react`). Never call `router.refresh()` outside a `startTransition` block. This keeps the page interactive while the server re-renders.

3. **Optimistic UI**: Use `useOptimistic` for instant feedback on actions (dismiss/interest/analyze). Pair with `sonner` toast showing "Desfazer" (undo) on success. See `components/opportunity-feedback.tsx` for the pattern.

4. **Keyboard shortcuts**: Nav is bound via `lib/keyboard-shortcuts.ts` (pure `matchShortcut` function, unit-tested). The sidebar renders hints and registers bindings through `useKeyboardShortcuts`. Palette opens on `?` or `⌘K` and is mounted once by the sidebar (dialog portals to `<body>`).

5. **Theme tokens**: All colors live in `app/globals.css` `@theme` block as CSS custom properties (`--color-canvas`, `--color-ink`, etc.). Dark mode via `:root[data-theme="dark"]` or `@media (prefers-color-scheme: dark)`. An inline script in `app/layout.tsx` reads `lixto.theme` localStorage before hydration to avoid flash.
