---
id: 140
status: done
model: haiku
depends_on: []
max_attempts: 3
files:
  - web/package.json
  - web/package-lock.json
  - web/app/layout.tsx
  - web/components/ui/toaster.tsx
  - web/components/ui/skeleton.tsx
---
## Goal
Install the cycle-27 client libraries and mount their providers once in the root layout, so every later ticket can import `nuqs`, `sonner`, `cmdk` and `next-view-transitions` without touching `package.json` or `app/layout.tsx` again.

## Context
PRODUCT.md (cycle 27). Exact versions, already checked against Next 16.3 / React 19.2.8 peer ranges: `nuqs@2.10.1`, `sonner@2.0.8`, `cmdk@1.1.1`, `next-view-transitions@0.3.5`. Install with `npm install --save-exact`.

`web/app/layout.tsx` today renders `<html><body>{children}</body></html>` with the Inter font variable. Wrap `{children}` as:
```tsx
<ViewTransitions>           // from "next-view-transitions"
  <NuqsAdapter>{children}</NuqsAdapter>   // from "nuqs/adapters/next/app"
  <Toaster />
</ViewTransitions>
```
`Toaster` is a client component in `web/components/ui/toaster.tsx` wrapping sonner's `<Toaster position="bottom-right" closeButton toastOptions={{ classNames: {...} }} />`, styled with the design tokens from `web/app/globals.css` (`bg-surface`, `border-line`, `text-ink`, `text-ink-muted`, `rounded-[10px]`, `shadow-[0_8px_24px_rgba(24,24,27,.1)]`), duration 5000, no icons.

`web/components/ui/skeleton.tsx`: server-safe `Skeleton({ className })` → `<div aria-hidden data-skeleton className={"animate-pulse rounded-md bg-surface-raised " + className} />`, plus `SkeletonText({ lines = 3 })` (stacked `h-3` bars, last one `w-2/3`). Respect `motion-reduce:animate-none`. `data-skeleton` is the marker later runtime probes grep for.

## Checks (run in order — cheapest first)
1. `cd web && npm run lint`
2. `cd web && node -e "const p=require('./package.json');for(const d of ['nuqs','sonner','cmdk','next-view-transitions'])if(!p.dependencies[d])process.exit(1)"`
3. `cd web && npm run build`
4. `cd web && npm test`

## Done when
- `npm run build` succeeds with the three providers mounted; `/login` still renders (providers are inert there).
- `import { Skeleton } from "@/components/ui/skeleton"` and `import { Toaster } from "@/components/ui/toaster"` compile.

## Not included
- Any use of the libraries beyond mounting (tabs, filters, palette, toasts come in 143–149).
- Removing `app/loading.tsx` (ticket 141).
