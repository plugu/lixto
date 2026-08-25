---
mode: mvp
routing_profile: cloud
parallel_default: parallel
---

# Lixto — intelligence layer: enrich, match, converse (cycle 16)

## What / why
Lixto's vision is an AI agent for public procurement — the user states an objective ("find open bids with pencils in RJ my company can join") and the agent searches, analyzes and recommends. The PNCP ingestion foundation already exists (backfill, incremental sync, itens/arquivos, CNAE + sector classification, fit-triage and deep-analysis agents, multi-tenant empresas/auth/documentos). What's missing is the intelligence layer that makes it an agent instead of a dashboard.

This cycle builds three connected pieces on the existing system:

1. **Global enrichment.** One canonical, versioned enrichment per licitação, produced once at ingestion and reused by every empresa (never re-analyzed per customer). Deterministic parsing first; cheap LLM only for what code can't derive (categories, keywords/synonyms, candidate CNAEs with confidence, requirements, ME/EPP conditions, delivery, risk flags, summary). Stored as canonical JSON with `schema_version`, `model`, `confidence`. pgvector embeddings where semantic similarity earns its keep — no separate vector DB.
2. **Per-empresa profile + match engine.** Profile moves from the single `company_profile.md` into per-tenant DB tables (CNAEs, products/services + synonyms, UFs, value range, preferences — building on existing empresa tables). Match engine scores enriched licitação × empresa profile deterministically + semantically, returning a score **and machine-readable reasons**. LLM only for ambiguous/high-value cases.
3. **Conversational interface.** Chat-first screen where natural language becomes a safe structured intent (`search_procurements`, `get_procurement`, `check_company_eligibility`, `calculate_match`, `analyze_procurement`), executed by backend tools — the LLM orchestrates tools, never writes SQL. Quick filter chips (UF, modality, status, value) as accelerators. Existing dashboard tables remain as the power-user view.

Model provider stays abstracted (cheap tier for classification, stronger tier only for deep analysis), consistent with the tiered cost strategy already in use (gpt-5-mini triage).

## Primary user story
As a user of a cadastro'd empresa, I ask Lixto in natural language "encontre licitações abertas com lápis como item no Rio de Janeiro que minha empresa pode participar" and get scored, explained matches drawn from globally-enriched data — then continue the conversation ("analise a segunda", "por que participar?") without touching a filter panel.

## Out of scope
- Proactive mode (daily digest, notifications on new matches) — next cycle
- Prepare/execute (documents, proposals, any consequential action) and approval workflow
- Learning loop / feedback capture tables
- Multi-agent architecture; separate vector infrastructure
- pgvector/embeddings this cycle — production Postgres is stock `postgres:18` without the extension; semantic similarity comes from FTS + trigram + enrichment keywords for now
- Deleting `company_profile.md` / the legacy triage+deep `analise` pipeline — it stays untouched (still feeds the Fit badge) until a later cycle removes it
- Re-enriching the same licitação per empresa
- Sending whole PDFs to an expensive model by default
- LLM-generated SQL
- New ERP-style screens; landing-page changes

## Success demo
Done when, logged in as an empresa with a DB profile, I type the pencil query in the chat, receive matched licitações with score + reasons (from enrichment produced once and shared across empresas), and can follow up with "analise a segunda" in the same conversation — with `npm run build` and `pytest` green.
