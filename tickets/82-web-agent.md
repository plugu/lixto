---
id: 82
status: done
model: opus
depends_on: [81]
max_attempts: 4
files:
  - web/lib/normalize.ts
  - web/lib/normalize.test.ts
  - web/lib/profile-queries.ts
  - web/lib/profile-queries.test.ts
  - web/lib/perfil-queries.ts
  - web/lib/perfil-queries.test.ts
  - web/lib/match-engine.ts
  - web/lib/match-engine.test.ts
  - web/lib/match-queries.ts
  - web/lib/match-queries.test.ts
  - web/lib/agent/**
  - web/app/api/chat/route.ts
  - web/app/(app)/company/profile/**
  - web/app/(app)/empresa/perfil/**
  - web/app/(app)/lixto/page.tsx
  - web/components/profile-form.tsx
  - web/components/perfil-match-form.tsx
  - web/components/chat/**
  - web/components/sidebar.tsx
  - web/lib/types.ts
  - web/lib/auth.ts
  - web/lib/queries.ts
  - web/lib/detail-queries.ts
  - web/lib/analise-queries.ts
  - web/lib/enriquecimento-queries.ts
  - web/lib/portais.ts
  - web/lib/tenant-types.ts
  - web/lib/empresa-queries.ts
  - web/lib/cnpj-lookup.ts
  - web/lib/cnpj-lookup.test.ts
  - web/app/(app)/signup/actions.ts
  - web/lib/status.ts
  - web/lib/format.test.ts
  - web/components/status-badge.tsx
---
## Goal
Company match profile, match engine, agent tools, chat runtime and the `/lixto` screen run on the new schema; the legacy compat shims are removed.

## Context

Read `PRODUCT.md`, `docs/adr/001-lixto-data-model.md` (D4 `company_profiles`, D3 `procurement_enrichments` + `procurement_cnaes`/`procurement_embeddings`/`procurement_categories`, D5 `conversations`/`messages`/`agent_runs`), `web/AGENTS.md`. **Port with rename**: `perfil-queries`→`profile-queries` (+ page `/company/profile`, `profile-form.tsx`), `match-engine.ts` (same weights: CNAE 35/25, terms 35/25/15, state ±, value ±, ME/EPP −40, certification −5, technical certificate −5, exclusion −50, semantic ≥0.55 +20 / ≥0.40 +10; reason codes in English: `cnae_primary, cnae_secondary, term_enrichment, term_text, state_ok, state_out, value_ok, value_out, value_unknown, me_epp_exclusive, requires_certification, requires_technical_certificate, exclusion, semantic_high, semantic, no_profile`), `match-queries.ts` (candidates from `procurements` ⨝ `procurement_enrichments` ⨝ `procurement_embeddings` ⨝ `procurement_cnaes` vs `company_cnaes`/`company_profiles`; `ProcurementRef` keyed by `source_id`), `agent/{types,tools,llm,embed,run,conversation-queries}.ts` (tools keep their five names; `ToolContext = {companyId, size, companyName}`; env `LIXTO_LLM_*`, `LIXTO_CHAT_MODEL`), `api/chat/route.ts`, chat components (`ProcurementRefCard`, motivo labels for the English codes). Each chat run also inserts an `agent_runs` row (`kind='chat'`, `company_id`) with counters `{rounds, tool_calls}`.

Add the `Match` tab (`/company/profile`) to the company nav constant in the pages owned by ticket 80 — coordinate by adding it only in `sidebar.tsx`'s `COMPANY_ITEMS` export that those pages consume; if they hardcode the nav, add the entry in `web/lib/types.ts` as `COMPANY_NAV` and import it (touching those page files is allowed only for that import).

Also from ticket 80: collapse `Session`/`ActiveSession` back into one `Session` type (fix `web/lib/agent/run.test.ts` fixture to the English shape), delete `web/lib/tenant-types.ts` and `web/lib/empresa-queries.ts` shims, drop the `session.usuario`/`session.empresa` getters, and make `web/lib/cnpj-lookup.ts` emit `MEDIUM/LARGE` directly (remove the mapping in `signup/actions.ts` — add `web/lib/cnpj-lookup.ts` + its test and `web/app/(app)/signup/actions.ts` to your files).

From ticket 81 (merged): compat modules left ONLY for `lib/agent/tools.ts` and still pointing at legacy tables — `web/lib/{queries,detail-queries,analise-queries,enriquecimento-queries,portais}.ts` — port tools to `procurement-queries.ts` (`fetchProcurements`, `parseFilters`), `procurement-detail-queries.ts` (`fetchProcurementDetail/fetchItems/fetchDocuments`, children keyed by numeric `id`), `enrichment-queries.ts` (`fetchEnrichment`), `status.ts` (`computeProcurementStatus`, `ProcurementStatus` open|upcoming|closed), `portals.ts` (`ACTIVE_PORTALS`), then DELETE those compat modules (add them to your files) and remove `computeStatus`/`StatusLicitacao`/`LEGACY_STATUS_LABELS` from `status.ts` + the legacy union in `status-badge.tsx` (add `web/lib/status.ts`, `web/lib/format.test.ts`, `web/components/status-badge.tsx` to your files).

Delete the compat re-exports/getters that ticket 80 left in `types.ts`/`auth.ts`; delete all legacy Portuguese-named files in your `files:` list.

## Checks (run in order — cheapest first)
1. `cd web && npx tsc --noEmit`
2. `cd web && npm run lint`
3. `cd web && npm test`
4. `cd web && npm run build`
5. `! grep -rEn "empresa|usuario|licitacao|perfil|enriquecimento|conversa|mensagem" web/lib web/app web/components --include='*.ts' --include='*.tsx' | grep -vE "label|title|placeholder|aria-|>[^<]*[A-Za-zçãõ]|\"[^\"]*(empresa|licitação|licitações|perfil)[^\"]*\"" ` — identifiers only; Portuguese UI strings are allowed. If the regex is noisy, replace it with an explicit list of the identifier patterns you removed and prove each returns nothing.
6. Runtime probe (session cookie as in ticket 80; profile row inserted or saved via UI): `curl -s -o /tmp/l.html -w '%{http_code}\n' -b "lixto_session=$token" localhost:3101/lixto` → `200` + `grep -q 'Nova conversa'`; with `LIXTO_LLM_API_KEY` set, `curl -s -b … -H 'content-type: application/json' -d '{"text":"liste 3 licitações abertas"}' localhost:3101/api/chat` → 200 with `refs`; otherwise skip and say so.

## Done when
- `/company/profile` saves to `company_profiles` (with embedding when a key exists); `fetchMatches(companyId, …)` scores against the new tables; `/lixto` chat works end to end; `agent_runs` gets a `chat` row per request.

## Not included
- Proactive mode, persisted `matches`/`opportunities` writes, new tools for plans/contracts.
