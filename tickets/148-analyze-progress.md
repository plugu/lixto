---
id: 148
status: done
model: sonnet
depends_on: [140]
max_attempts: 3
files:
  - web/components/analyze-button.tsx
  - web/components/analysis-panel.tsx
  - web/components/radar-analysis.tsx
  - web/components/ui/progress-steps.tsx
---
## Goal
"Analisar com IA" shows a staged progress indicator with elapsed time and swaps in the result without re-rendering the whole page, so a 30–90 s job feels attended rather than frozen.

## Context
`analyze-button.tsx` polls `analysisStatusAction` every `POLL_INTERVAL_MS` and calls `router.refresh()` on `done` (full RSC re-render, scroll jump). `analysis_jobs.status` is only `queued|running|done|error` (no stages; no migration this cycle). `radar-analysis.tsx` runs the on-demand radar analysis with `useTransition`.

Build `components/ui/progress-steps.tsx` (client): `ProgressSteps({ steps: string[], activeIndex, startedAt })` — vertical list, done steps `text-ink-muted` with a check icon from `@/components/ui/icons`, active step with a small spinner and `mm:ss` elapsed (updates each second), future steps `text-ink-faint`. Steps for procurements: `["Na fila", "Baixando documentos", "Lendo o edital", "Montando o dossiê"]` — map `queued`→0, `running`→ index advancing by elapsed time (0–15 s → 1, 15–45 s → 2, >45 s → 3; copy makes clear it is an estimate: caption "Tempo estimado: 1–2 min"). `error` → inline `text-danger` message + "Tentar novamente".

In `analyze-button.tsx`: keep polling but on `done` call the status action once more for the analysis payload if it returns it, else `router.refresh()` **only** wrapped in `startTransition` so the current UI stays interactive and scroll is preserved; use `sonner` `toast.success("Análise pronta")` with an action "Ver" that scrolls to `#analysis-panel`. Give the panel root in `analysis-panel.tsx` `id="analysis-panel"` and `scroll-mt-6`. Apply the same `ProgressSteps` (steps `["Analisando o item", "Cruzando com o perfil", "Escrevendo o parecer"]`) to `radar-analysis.tsx` while its transition is pending.

## Checks (run in order — cheapest first)
1. `cd web && npm run lint`
2. `cd web && npm run build`
3. `cd web && npm test`
4. `cd web && ! grep -n 'router.refresh()' components/analyze-button.tsx | grep -v startTransition`

## Done when
- Clicking Analisar shows the four steps with a running timer; when the job finishes the dossier appears and a toast offers "Ver"; the page does not jump to top.

## Not included
- Worker-side stages or SSE; job cancellation.
