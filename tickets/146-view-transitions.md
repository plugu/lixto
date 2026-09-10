---
id: 146
status: done
model: haiku
depends_on: [143]
max_attempts: 3
files:
  - web/components/sidebar.tsx
  - web/components/ui/top-bar.tsx
  - web/components/ui/button.tsx
  - web/components/ui/pill-tabs.tsx
  - web/app/globals.css
---
## Goal
Route changes cross-fade (150 ms) instead of snapping, using the native View Transitions API through `next-view-transitions`, with reduced-motion respected.

## Context
`ViewTransitions` provider is already mounted in `app/layout.tsx` (ticket 140). Swap `import Link from "next/link"` for `import { Link } from "next-view-transitions"` in `sidebar.tsx`, `top-bar.tsx` and `LinkButton` in `button.tsx` (same props, drop-in). In `pill-tabs.tsx` the push is owned by nuqs, so `useTransitionRouter` cannot be used; instead call `document.startViewTransition?.(() => startTransition(() => setValue(v)))` guarded by `typeof document !== "undefined" && "startViewTransition" in document`. In `globals.css` add:
```css
::view-transition-old(root), ::view-transition-new(root) { animation-duration: 150ms; }
@media (prefers-reduced-motion: reduce) {
  ::view-transition-old(root), ::view-transition-new(root) { animation: none; }
}
```
Give `<main>`'s inner container nothing special; give the sidebar `style={{ viewTransitionName: "sidebar" }}` so it does not fade with the page.

## Checks (run in order — cheapest first)
1. `cd web && npm run lint`
2. `cd web && npm run build`
3. `cd web && npm test`
4. `cd web && ! grep -rn 'from "next/link"' components/sidebar.tsx components/ui/top-bar.tsx components/ui/button.tsx`

## Done when
- Navigating Painel → Radar in Chrome shows a short cross-fade of the content area; sidebar stays static; Firefox (no API) behaves as before.

## Not included
- Per-element shared-element transitions; animating list items.
