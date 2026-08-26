---
id: 93
status: todo
model: sonnet
depends_on: [91]
max_attempts: 3
files:
  - web/app/(app)/opportunities/page.tsx
  - web/app/(app)/opportunities/actions.ts
  - web/components/opportunity-card.tsx
  - web/components/opportunity-feedback.tsx
  - web/components/digest-banner.tsx
  - web/app/(app)/lixto/page.tsx
  - web/components/chat/chat.tsx
  - web/app/(app)/dashboard/page.tsx
  - web/components/sidebar.tsx
  - web/lib/digest-queries.ts
  - web/lib/digest-queries.test.ts
---
## Goal
The daily digest is visible in-app: `/lixto` opens with "Lixto analisou N novas oportunidades…", `/opportunities` lists them with score, reasons and GO/NO-GO, and each card takes "Tenho interesse" / "Descartar".

## Context

Read `PRODUCT.md` (§3–4), `web/AGENTS.md`, `docs/WEB_STYLE.md`. Data from ticket 90/91 modules: `listOpportunities`, `getOpportunity`, `setOpportunityState`, `insertFeedback`, `getLastRun`, `ATTENTION_SCORE` (`web/lib/opportunity-queries.ts`), `OpportunityRow` (has `verdict`/`rationale`). Reuse `ProcurementRefCard`'s look (`web/components/chat/procurement-ref-card.tsx`: score badge tones, reason chip labels) — extract shared label maps if needed, but do not change its props. Session via `requireSession()`; company id only from the session. Server actions follow `web/app/(app)/company/profile/actions.ts` (`useActionState`, `{ ok } | { error }`).

### `digest-queries.ts`
`getDigest(companyId): Promise<{ run: {started_at, finished_at, counters} | null; newCount: number; matchedCount: number; attentionCount: number; attention: OpportunityRow[] }>` — `run` = last global `match` run (`getLastRun("match")`); counts from `opportunities`/`matches` created since that run's `started_at` for this company (`matched` = state in matched/recommended, `attention` = score ≥ 70), `attention` = `listOpportunities(companyId, { states: ["matched","recommended"], minScore: ATTENTION_SCORE, limit: 5, sinceRunAt })`. `newCount` = `counters.scored ?? 0`. Tests with mocked pool/opportunity-queries.

### UI
- `digest-banner.tsx` (server): "Lixto analisou **N** novas oportunidades desde {data}. **M** combinam com sua empresa. **K** merecem atenção." + link "Ver oportunidades". When no run yet: "Lixto ainda não analisou oportunidades para sua empresa." Muted card, `bg-accent-soft` accent line.
- `opportunity-card.tsx` (server): description (2-line clamp), agency · city/state · modality, value, closes-at, score badge (reuse tones), up to 4 reason chips, verdict badge (`go` → "GO" ok, `no_go` → "NO-GO" danger, `borderline` → "Borderline" warn) with rationale in a `<details>`; link to `/procurement/[sourceId]`; slot for `OpportunityFeedback`.
- `opportunity-feedback.tsx` (client): two buttons "Tenho interesse" / "Descartar"; Descartar opens an inline reason select (`fora do ramo`, `valor`, `prazo`, `exigência`, `outro`) + optional text; calls server actions; optimistic hide on dismiss.
- `opportunities/actions.ts`: `markInterestAction(opportunityId)` → `insertFeedback(companyId, id, userId, "accepted", null)` + `setOpportunityState(companyId, id, "analyzed")`; `dismissAction(opportunityId, reason)` → `insertFeedback(... "rejected", reason)` + state `dismissed`; both `revalidatePath("/opportunities")` and `/lixto`.
- `opportunities/page.tsx`: `DigestBanner` + tabs by state (Atenção ≥70 / Todas / Descartadas) via searchParam `view`; list of `OpportunityCard`s; empty state copy.
- `/lixto`: render `DigestBanner` + the attention cards above the chat when the conversation is empty (pass as a server-rendered slot into `Chat` — add an optional `intro?: ReactNode` prop to `components/chat/chat.tsx`, shown when there are no messages).
- `/dashboard`: "Oportunidades de hoje" `Section` with the three counts and up to 3 cards, link to `/opportunities`.
- `sidebar.tsx`: `NAV_ITEMS` add `/opportunities` ("Oportunidades") after Lixto.

## Checks (run in order — cheapest first)
1. `cd web && npx tsc --noEmit`
2. `cd web && npm run lint`
3. `cd web && npm test`
4. `cd web && npm run build`
5. Local probe (opportunities exist from tickets 90/91 probes; session cookie as in ticket 80): `curl -s -b "lixto_session=$token" localhost:3101/opportunities` → 200 and `grep -q 'Tenho interesse'`; `/lixto` → 200 with `grep -q 'analisou'`; `/dashboard` → 200 with `grep -q 'Oportunidades de hoje'`.

## Done when
- Digest counts match the DB; dismissing a card writes `opportunity_feedback` (kind `rejected`, reason) and the card disappears from Atenção; marking interest sets state `analyzed`.

## Not included
- Email/notifications; chat tools (94); learning from feedback.
