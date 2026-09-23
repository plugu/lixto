---
id: 169
status: done
model: sonnet
depends_on: [168]
max_attempts: 3
files:
  - web/lib/case-labels.ts
  - web/app/(app)/cases/page.tsx
  - web/app/(app)/cases/loading.tsx
  - web/app/(app)/cases/[id]/page.tsx
  - web/app/(app)/cases/[id]/actions.ts
  - web/app/(app)/cases/[id]/actions.test.ts
  - web/components/case-verdict-table.tsx
  - web/components/case-decision.tsx
  - web/components/sidebar.tsx
  - web/lib/opportunity-queries.ts
---
## Goal
The operator opens **Casos**, sees every case with its verdict counts, opens one, reads the habilitação table with citations and the dossier dates, and answers **Vou enviar / Não vou / Falta documento**; the answer is stored on the case and mirrored into `opportunity_feedback`.

## Context
Data comes from ticket 168: `listCases`, `getCase`, `listCaseChecks`, `decideCase` in `web/lib/case-queries.ts` (`CaseRow` carries procurement fields, `decided_by_name`, and `met/expiring/missing/manual` counts; `decideCase` only succeeds while `status = 'ready'` and returns `{opportunity_id}` or null). Labels for requirement categories and severities exist in `web/lib/analysis-labels.ts` (`REQUIREMENT_CATEGORY_LABELS`, `SEVERITY_LABELS`, `DATE_KIND_LABELS`); document-kind labels in `DOCUMENT_KINDS` (`web/lib/types.ts`). Citations render with `CitationLinks` (`web/components/citation-link.tsx`) fed by `fetchDocuments(procurementId)` from `web/lib/procurement-detail-queries.ts`. Dates: `fetchAnalysis(procurementId)?.dates` (`web/lib/analysis-queries.ts`). Match reasons: `getOpportunity(companyId, sourceId)` → `OpportunityRow.reasons` (`web/lib/opportunity-queries.ts`).

UI conventions: per-route `loading.tsx` (copy `web/app/(app)/opportunities/loading.tsx`), `PageHeader` (`title`, `subtitle`, `actions`), `Card`, `Badge` (`tone`: neutral|ok|warn|off|accent), `EmptyState` (`title`, `hint`), `Button` (`variant`: primary|secondary|ghost|pill), `Input`, `Skeleton` — all in `web/components/ui/`. Client-side feedback pattern (`useTransition`, `sonner` `toast`, `toast.error(result.error)`): `web/components/opportunity-feedback.tsx`. Procurement link form: `/procurement/${encodeURIComponent(source_id)}` (`web/components/opportunity-card.tsx:106`). Server-action test pattern (mocks hoisted): `web/app/(app)/admin/companies/actions.test.ts`. **vitest resolves the `@/` alias only for ids that are mocked** (ticket 168 hit this): every `@/...` import of the module under test must have its own `vi.mock("@/...")`, or the test fails to resolve. Never import `.tsx` pages in vitest.

### Work
1. `web/lib/case-labels.ts` (Portuguese copy, English identifiers): `CASE_STATUS_LABELS` {waiting_analysis: "Aguardando análise", ready: "Pronto para decidir", decided: "Decidido"}; `DECISION_LABELS` {submit: "Vou enviar", skip: "Não vou", missing_document: "Falta documento"}; `CHECK_STATUS_LABELS` {met: "Atende", expiring: "Vence antes da sessão", missing: "Falta", manual: "Verificar"}; `CHECK_STATUS_TONES` {met: "ok", expiring: "warn", missing: "warn", manual: "neutral"}; `OUTCOME_LABELS` {won: "Ganhou", lost: "Perdeu", disqualified: "Desclassificado"}; `SESSION_SOURCE_LABELS` {dossier_session: "sessão pública no edital", dossier_proposal_deadline: "prazo final de propostas", procurement_closes_at: "encerramento no PNCP"}; `documentKindLabel(kind)` from `DOCUMENT_KINDS`.
2. `web/app/(app)/cases/page.tsx` (server, `dynamic = "force-dynamic"`, `metadata.title = "Casos"`): `requireSession()`, `listCases(session.user.companyId)`. `PageHeader` title "Casos", subtitle "Oportunidades que o agente preparou para a sua decisão". One `Card` per case (single column), whole card wrapped in `Link` to `/cases/${id}`: description (fallback `source_id`), `agency_name · state_uf`, "Sessão: dd/mm/aaaa" via `formatDateBR(session_at)` or "Sessão: a confirmar", status `Badge` (`decided` → show `DECISION_LABELS[decision]` instead), count chips built only for non-zero counts ("1 atende", "2 faltam", "1 vence antes", "1 verificar"), outcome `Badge` when `outcome` set. `EmptyState` title "Nenhum caso ainda", hint "Quando uma recomendação GO surgir, o agente monta o caso aqui.".
3. `web/app/(app)/cases/loading.tsx`: header skeleton + six `h-[120px]` skeletons.
4. `web/app/(app)/cases/[id]/page.tsx`: parse id (`Number`, `notFound()` if not integer); `getCase(companyId, id)` → `notFound()` when null; in parallel `listCaseChecks`, `fetchDocuments(case.procurement_id)`, `fetchAnalysis(case.procurement_id)`, `getOpportunity(companyId, case.source_id)`. Sections:
   - Header `Card`: description, `agency_name · city_name/state_uf · modality_name`, `formatCurrencyBRL(estimated_value)` when present, "Sessão: dd/mm/aaaa (fonte: …)" with `SESSION_SOURCE_LABELS`, status/decision badge, link "Ver licitação" → procurement page.
   - Participation notes (only when present in `reasons`): `me_epp_exclusive` → "Exclusivo ME/EPP — confira o porte da empresa"; `state_out` → "Fora da UF do seu cadastro"; `value_out` → "Fora da sua faixa de valor". Render as `warn` badges under the header.
   - "Habilitação" `Card` with `CaseVerdictTable`.
   - "Prazos" `Card`: `analysis?.dates` rows — `DATE_KIND_LABELS[kind]`, `formatDateBR(occurs_at)` or `raw_text`; hidden when no dossier.
   - "Sua decisão" `Card` with `CaseDecision`.
5. `web/components/case-verdict-table.tsx` (server): props `{checks: CaseCheckRow[]; documents: DocumentRow[]}`; columns **Exigência** (title; below it `REQUIREMENT_CATEGORY_LABELS[category]`, "obrigatória" when mandatory, `SEVERITY_LABELS[severity]`, then `<CitationLinks citations documents />`), **Documento** (`documentKindLabel(document_kind)`; `document_file_name` + "válido até dd/mm/aaaa" when present; "—" for manual), **Situação** (`Badge` with `CHECK_STATUS_LABELS` / `CHECK_STATUS_TONES`). Rows ordered as returned. Use `web/components/ui/table.tsx` primitives if they fit, else a plain `<table>` with the same classes as `items-table.tsx`.
6. `web/components/case-decision.tsx` (`"use client"`): props `{caseId, status, decision, decisionNote, decidedAt, decidedByName}`. Undecided (`status === "ready"`): three `Button`s — "Vou enviar" (primary), "Não vou" (secondary), "Falta documento" (secondary; reveals an `Input` id `decision-note` placeholder "Qual documento?" — required, max 200 chars, and a "Confirmar" button). Each calls `decideCaseAction` inside `useTransition`; on `{ok}` `toast("Decisão registrada")`, on `{error}` `toast.error`. `status === "waiting_analysis"`: text "Aguardando a análise do edital para montar o caso.". Decided: "Você respondeu **{label}** em dd/mm/aaaa{ · nome}" plus the note when present.
7. `web/app/(app)/cases/[id]/actions.ts` (`"use server"`): `decideCaseAction(caseId: number, decision: string, note: string | null): Promise<{ok: true} | {error: string}>` — `requireSession()`; decision must be one of `submit|skip|missing_document` else `{error: "Escolha uma resposta."}`; `missing_document` requires a trimmed note (1–200 chars) else `{error: "Diga qual documento falta."}`; `decideCase(session.user.companyId, caseId, session.user.id, decision, note)` → null → `{error: "Caso não encontrado ou já decidido."}`; side effects: `skip` → `insertFeedback(companyId, opportunity_id, userId, "rejected", "caso:nao_vou")` + `setOpportunityState(companyId, opportunity_id, "dismissed")`; `submit` → `insertFeedback(..., "participated", "caso:vou_enviar")`; `missing_document` → no feedback. `revalidatePath("/cases")` and `revalidatePath(`/cases/${caseId}`)`. Test file mirrors the admin actions test: invalid decision, missing note, `skip` (feedback + dismissed), `submit` (feedback only), not found.
8. `web/lib/opportunity-queries.ts`: widen `insertFeedback`'s `kind` parameter to `"accepted" | "rejected" | "participated" | "won" | "lost" | "disqualified"` (the DB CHECK already allows them). No other change.
9. `web/components/sidebar.tsx`: insert `{ href: "/cases", label: "Casos", icon: FileText }` immediately after the `/opportunities` entry (line 89); `FileText` is already imported.

Runtime probe preconditions: as ticket 168 (dev DB, dev server, `web/.env.local` token, cookie `lixto_session=devprobe` = user 1 / company 1). Run the 168 fixture + batch first (check 6 below does it).

## Checks (run in order — cheapest first)
1. `cd web && npm run lint`
2. `cd web && npx vitest run 'app/(app)/cases/[id]/actions.test.ts' lib/tenant-isolation.test.ts`
3. `cd web && npx tsc --noEmit`
4. `cd web && npm test`
5. `cd web && npm run build`
6. `docker exec -i plataforma-licitante-db-1 psql -U lixto -d lixto -q < scripts/dev/case-fixture.sql && tok=$(grep -E '^LIXTO_INTERNAL_TOKEN=' web/.env.local | cut -d= -f2- | tr -d '"') && curl -s -X POST -H "x-lixto-internal-token: $tok" localhost:3000/api/internal/cases/run | grep -q '"runId"'`
7. `curl -s -b lixto_session=devprobe localhost:3000/cases | grep -q 'Pronto para decidir' && curl -s -b lixto_session=devprobe localhost:3000/cases | grep -q 'href="/cases"'`
8. `id=$(docker exec plataforma-licitante-db-1 psql -U lixto -d lixto -At -c "select id from cases where company_id = 1 order by id desc limit 1") && out=$(curl -s -b lixto_session=devprobe localhost:3000/cases/$id) && echo "$out" | grep -q 'Atende' && echo "$out" | grep -q 'Falta' && echo "$out" | grep -q 'Verificar' && echo "$out" | grep -q 'Vou enviar'`
9. `curl -s -b lixto_session=devprobe localhost:3000/cases/999999 > /tmp/case404.html && grep -qiE '404|não encontrad|not found' /tmp/case404.html && ! grep -qiE 'Habilitação|Sua decisão' /tmp/case404.html`  <!-- amended during the run: this repo's streaming pages with a sibling loading.tsx keep HTTP 200 after notFound() (verified identical on the pre-existing /radar/[id] and /procurement/[sourceId]); the assertion is therefore on the rendered body and the absence of case data, not the status code. -->

## Done when
- All nine checks green: the list shows the fixture case, the detail page shows the four verdict lines with the decision buttons, and an unknown id renders the not-found UI with no case data.

## Not included
- Bundle download button (171); outcome block and "Fomos desclassificados" (172).
- Undo of a decision; re-deciding a decided case; keyboard shortcut for `/cases`; changes to `opportunity-card.tsx` or the opportunities page.
- Any LLM call; any change to case-queries.ts beyond consuming it.
