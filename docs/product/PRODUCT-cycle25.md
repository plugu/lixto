---
mode: mvp
routing_profile: cloud
parallel_default: sequential
---

# Lixto — AI Tender Analysis, V1 (cycle 25)

## What / why
Today's enrichment is a shallow index built from at most two edital PDFs: enough to match and search, not to decide. Users still read 150 pages to learn what disqualifies them and what failure costs. V1 replaces that pass with one deep, cited, company-agnostic dossier per procurement answering "what must I know before deciding?" from the documents alone. Company fit stays a separate, later step.

Repo facts that shape V1:
- **One pass replaces `enrich run`.** New worker `lixto analyze run` writes `procurement_enrichments` + facet tables exactly as today (match engine, semantic search, recommend, digest untouched; payload `schema_version` 2.0) **and** new dossier tables. Old worker, prompt and `enrich-run` schedule are deleted. `enrich embed` stays.
- **New tables, never altered old ones (ADR 001).** Migration adds: `tender_analyses` (one per procurement, `version`, `status`, `model`, `document_set_hash`, executive summary, key facts, overall risk), `tender_analysis_facts` (basic + commercial fields), `tender_analysis_dates`, `tender_analysis_requirements` (category incl. specification/guarantee, mandatory, severity), `tender_analysis_penalties`, `tender_analysis_risks` (risk, red flag, contradiction, amendment), `tender_analysis_missing`, `analysis_jobs`, and `procurement_document_pages` (per-page text). Items stay the PNCP-structured `procurement_items` (already on the page); the LLM only flags restrictive specifications. Every fact row carries `(document sequence, page)` citations and `confidence` in {high, medium, low}.
- **All active PDFs, page-level text.** Extraction covers every active PDF (edital, TR, anexos, minuta); byte cap `LIXTO_ANALYZE_MAX_BYTES` (default 60 MB), prompt cap `LIXTO_ANALYZE_MAX_CHARS`. Doc tier model. DOCX/XLSX/HTML deferred. Documents are fed newest-last with publication dates so amendments override; the dossier flags changed requirements.
- **Fact vs inference vs missing.** Structured LLM output, schema-validated before persisting. Each statement is `fact` (must cite), `inference` (must say why), or the field goes to *missing*. Never invents values; never claims illegality, only "may deserve legal review".
- **Two entry points, one worker.** Cron analyses the fenced set under the global daily cap. An **"Analisar com IA"** button on any open procurement without a dossier enqueues a job (`analysis_jobs` row, web polls), capped per company by `LIXTO_ANALYZE_USER_DAILY_CAP` (default 10). Re-run only when the document set hash changes (`version` increments).
- **UI = detail page.** `EnrichmentPanel` becomes the dossier: header card (object, value, method, deadline with urgency, overall risk), then sections: resumo, itens, prazos, participação e habilitação (legal, fiscal, econômica, técnica), especificações restritivas, condições comerciais (entrega, pagamento, reajuste), garantias, penalidades, riscos e alertas, contradições, informações ausentes. Citations link to the PNCP document URL + page. Portuguese copy.

## Primary user story
As a Lixto user on a procurement page, I click "Analisar com IA" (or find it done) and within minutes read a cited dossier of what is bought, every requirement that can disqualify me, every deadline, penalty and guarantee, plus contradictions and gaps across documents, so I decide whether to prepare a bid without reading the package myself.

## Out of scope
- Company match, compliance matrix, documentation readiness, bid score, bid/no-bid verdict (V2; deterministic match + GO/NO-GO stay as they are)
- Per-procurement Q&A / chat (V2, with company data)
- DOCX, XLSX, HTML inputs; user-uploaded documents
- Historical prices, competitors, previous winners (V3)
- In-app PDF viewer (citation opens PNCP URL + page)
- Dossier in digest email; amendment alerts
- Any ML model; any autonomous bidding, pricing or legal action

## Success demo
Done when I can open a multi-PDF open procurement on prod, click "Analisar com IA", watch the job finish, and read a Portuguese dossier (items, dates, qualification, penalties, guarantees, risks, contradictions, missing info) where each fact has a clickable document+page citation, while semantic search, `/opportunities` matching and `recommend-run` still work, and `lixto analyze run` fills facets + dossier for the fenced set under the daily cap.
