---
mode: mvp
routing_profile: cloud
parallel_default: sequential
---

# Lixto — App fluidity (cycle 27)

## What / why
The logged-in app (`web/app/(app)/*`) looks right but does not *feel* fluid. Root cause is the navigation model, not the visuals: every route is `force-dynamic`, no route has a `loading.tsx`, filters and ⌘K are plain GET forms, and dashboard/procurements await every query before painting. Each click freezes the old page until the server answers, then snaps. Actions (dismiss, interest, analyze) wait on the server and re-render the whole page.

This cycle makes the app behave like a 2026 all-day tool (Linear, Attio, Vercel): instant feedback on every click, streamed pages, filters that apply on change, optimistic actions with undo, a real command palette, and the visual polish those unlock (answer-first dashboard, dark mode, touch targets). No new palette, typography or layout grid — the calm "Slate" language stays.

Repo facts that shape the work:
- Next 16.3 / React 19.2.8 stable: no `experimental.viewTransition`, no `ViewTransition` export. Cross-route fades use `next-view-transitions@0.3.5`.
- URL state via `nuqs@2.10` (Next app-router adapter). URL contracts (`parseFilters`, `parseRadarFilters`, `parseChartScope`, `?view=`) do **not** change — server pages keep parsing `searchParams`.
- Toasts via `sonner@2.0.8`; palette via `cmdk@1.1.1`.
- `vitest` runs in node (no jsdom): tests cover `web/lib/*` logic only; UI is verified by `lint`, `build`, and curl runtime probes against `npm run dev` on :3000 with the dev probe session cookie `lixto_session=devprobe` (local DB, company 1).
- `analysis_jobs.status` is only `queued|running|done|error` — no stages; progress UI derives from status + elapsed time, no migration.

## Primary user story
As a Lixto user clicking through Painel, Oportunidades, Radar and Licitações, every click responds within one frame (skeleton, pending pill, or optimistic change), filters apply as I change them, and I can reach any procurement or page from ⌘K without a full reload.

## Out of scope
- New colour palette, typography, or page layouts beyond the dashboard reorder
- Python CLI, migrations, schedules, LLM provider decision
- Marketing site (`web/app/page.tsx`, `components/marketing/*`)
- Analysis job stages in the worker (would need a migration)
- Mobile bottom navigation

## Success demo
1. `cd web && npm run lint && npm run build && npm test` green.
2. With `npm run dev` on :3000 and the dev DB: `curl -s -b lixto_session=devprobe localhost:3000/dashboard` streams (`Transfer-Encoding: chunked`) and the first chunk contains `data-skeleton`.
3. In the browser: click Painel → Oportunidades → Radar → Licitações: each shows a skeleton/pending state immediately, no white flash; change a filter on Licitações: results update without "Aplicar" and without the sidebar remounting; dismiss an opportunity: card animates out, toast offers "Desfazer" and it comes back; ⌘K lists nav commands and live procurement results; system dark mode renders the app in dark tokens.
