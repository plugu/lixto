---
id: 152
status: done
model: haiku
depends_on: [151]
max_attempts: 3
files:
  - README.md
  - docs/ARCHITECTURE.md
  - CLAUDE.md
  - web/AGENTS.md
  - docs/WEB_STYLE.md
---
## Goal
Docs describe the cycle-27 navigation model so future agents keep it: per-route skeletons, URL-state hooks, optimistic actions with undo, the palette, dark mode.

## Context
Add to `docs/ARCHITECTURE.md` a "Web app interaction model" section (≤40 lines): loading boundaries per route (no root `loading.tsx`), `Suspense` sections in dashboard/procurements/radar, `lib/procurement-url.ts` / `lib/radar-url.ts` / `lib/url-state.ts` as the only places that build URLs, `PillTabs`, `sonner` toasts with undo pattern, `cmdk` palette + `lib/keyboard-shortcuts.ts`, theme tokens and `data-theme`. `CLAUDE.md` "Key Code Locations" table: add rows for those files. `README.md`: mention ⌘K, `g` shortcuts, dark mode in the web section. `docs/WEB_STYLE.md`: ticket 151 fixed the token table; the rest is stale cycle-8 text (fonts, sidebar width, `plic.sidebar` storage key) — fix only concrete facts that no longer hold (storage keys are `lixto.sidebar`, `lixto.theme`, `lixto.recent`, `lixto.procurements.cols`; sidebar `w-60`/`w-14`; ⌘K palette). `web/AGENTS.md`: rule "never add a `<form method=GET>` for filters; use the URL-state hooks; never call `router.refresh()` outside `startTransition`".

## Checks (run in order — cheapest first)
1. `grep -q 'procurement-url.ts' CLAUDE.md && grep -q 'Web app interaction model' docs/ARCHITECTURE.md && grep -q 'router.refresh' web/AGENTS.md`
2. `cd web && npm run lint`

## Done when
- The four docs mention the new files and rules; no stale reference to `app/loading.tsx` or the "Aplicar" button remains (`grep -rn 'Aplicar' docs README.md` empty).

## Not included
- Graphify update (run `graphify update .` at cycle close, outside the ticket).
