---
mode: mvp
routing_profile: cloud
parallel_default: sequential
---

# Lixto — Case agent V1: verdict, packet, one decision (cycle 30)

## What / why
Lixto stops at the recommendation. The operator still checks by hand whether the company qualifies, gathers the documents, and never records what happened. Competitors sell the reading; nobody closes the loop per opportunity (see `docs/product/ANALYSIS-case-agent.md`). V1 turns each GO recommendation into a **case** the agent works: a habilitação verdict computed from the dossier against the company's own uploaded documents, a downloadable bundle, one question to the operator, and the outcome pulled from PNCP results after the session.

Repo facts that shape V1:
- **Trigger**: a `recommendations` row (score ≥70, ≤5/company/day). One case per company × procurement, anchored on the existing `opportunities` row. If the procurement has no dossier yet, the case waits and enqueues `analysis_jobs` under the per-company cap.
- **Verdict is code, not LLM.** `tender_analysis_requirements` (legal, fiscal_labor, economic_financial, technical; mandatory; severity; document + page citation) map to `company_documents.kind` by deterministic rules. Each line is *atende* (document present, `valid_until` ≥ session date or undated), *vence antes da sessão*, *falta*, or *verificar* (no rule matches). Tier-0 gates already in the match reasons (ME/EPP exclusivity vs. company size, state) sit on top. Zero LLM spend per case.
- **Packet** = the case page: verdict table with citation links to the PNCP document and page, key dates from `tender_analysis_dates`, and a zip of the company's currently valid documents from `UPLOADS_DIR`.
- **One question**: one email through the existing outbox (new template) links to the case; the operator answers **Vou enviar / Não vou / Falta documento** (which one). The answer is stored on the case (new tables only; cycle-18 tables untouched per ADR 001; `agent_actions` may carry it).
- **Outcome**: after the session date the case's items enter the results demand queue (`results_requested_at`); `lixto sync results` runs in prod for those items only. Winner tax id equals the company → *ganhou*; another winner → *perdeu*; the operator can set *desclassificado*. Stored in `opportunity_feedback` (kinds already exist).
- **Cost fence**: no new LLM calls; HTTP only for results.

## Primary user story
As an operator of a beta company, I receive one email per GO opportunity, open the case, see in one table which habilitação requirements my uploaded documents satisfy, which expire before the session and which are missing, download the bundle, answer whether I will submit, and later see whether we won — without reading the edital or keeping a spreadsheet.

## Out of scope
- Price band or any homologated-price intelligence (V2)
- PCA / Radar-triggered cases (V2)
- WhatsApp, push, or any channel beyond in-app + email
- Generated declarations or any LLM-written text; portal submission or bidding
- Fetching certidões from government sites; OCR or fact extraction from uploaded documents (atestado scope, balance-sheet ratios)
- Learning from outcomes (ranking or scoring changes)
- Changes to the dossier, the match engine, or the recommender
- Cases for procurements outside the fence or without a dossier, beyond enqueueing the analysis

## Success demo
Done when, on prod, a GO recommendation for a beta company produces a case whose habilitação verdict cites the dossier and the company's uploaded documents; the operator gets one email, opens the case, downloads the bundle, answers "Vou enviar / Não vou / Falta documento"; and after the session the case shows *ganhou* or *perdeu* from PNCP results, correctable to *desclassificado*.
