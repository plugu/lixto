---
id: 147
status: done
model: sonnet
depends_on: [140]
max_attempts: 3
files:
  - web/components/opportunity-feedback.tsx
  - web/components/opportunity-card.tsx
  - web/components/radar-actions.tsx
  - web/components/radar-card.tsx
  - web/app/(app)/opportunities/actions.ts
  - web/lib/opportunity-queries.ts
  - web/lib/opportunity-queries.test.ts
  - web/lib/tenant-isolation.test.ts
---
## Goal
"Tenho interesse", "Descartar" (opportunities) and "Salvar"/"Ignorar" (radar) respond instantly with an animated card exit and a toast offering "Desfazer", instead of an inline reason form and a wait.

## Context
`opportunity-feedback.tsx` uses `useTransition` and hides the card on success only after the server answers; dismiss opens an inline reason `Select` + note. `radar-actions.tsx` follows the same pattern for `saveRadarAction/ignoreRadarAction/clearRadarAction` (`app/(app)/radar/[id]/actions.ts`, already has clear = undo; do not edit that file). Opportunity state machine: `setOpportunityState` (`lib/opportunity-queries.ts:209`), states in `migrations/001_core.sql:508`; `insertFeedback` writes the learning-loop row.

Work:
1. `lib/opportunity-queries.ts`: add `restoreOpportunityState(companyId, opportunityId, previousState)` — `UPDATE opportunities SET state=$3 WHERE id=$2 AND company_id=$1 AND state='dismissed'` — and `deleteRecentFeedback(companyId, opportunityId, userId, kind)` — deletes that user's `opportunity_feedback` row of `kind` newer than 2 minutes, ownership via `JOIN opportunities` on `company_id=$1`. Register both builders in `tenant-isolation.test.ts`; unit-test SQL in `opportunity-queries.test.ts`.
2. `opportunities/actions.ts`: `undoDismissAction(opportunityId, previousState)` and `undoInterestAction(opportunityId)` using the two queries + `revalidatePath("/opportunities")`. `dismissAction` keeps its `(id, reason)` signature; reason becomes optional (`"sem_motivo"` default).
3. `opportunity-feedback.tsx`: `useOptimistic` for the local status; on click the parent card gets `data-leaving` and animates `opacity-0 -translate-y-1 max-h-0` over 200 ms (`motion-reduce:transition-none`) before unmount; `toast("Oportunidade descartada", { action: { label: "Desfazer", onClick: undo } })` via `sonner`'s `toast`; undo re-shows the card (optimistic) and calls the undo action. Errors: `toast.error(message)` and revert. The reason picker moves into the toast description as five small pill buttons (same `DISMISS_REASONS`); picking one calls `dismissAction` again with the reason (idempotent update). Prop: `previousState` passed from `OpportunityCard` (`opportunity.state`).
4. `radar-actions.tsx`/`radar-card.tsx`: same exit animation + toast with "Desfazer" → `clearRadarAction`.

## Checks (run in order — cheapest first)
1. `cd web && npm run lint`
2. `cd web && npx vitest run lib/opportunity-queries.test.ts lib/tenant-isolation.test.ts`
3. `cd web && npm run build`
4. `cd web && npm test`

## Done when
- Dismissing a card removes it within one frame, a toast offers "Desfazer" for 5 s, undo brings the card back and the DB state is restored (`state` back to previous, feedback row deleted).

## Not included
- Bulk actions; keyboard shortcuts on cards (149); analysis buttons (148).
