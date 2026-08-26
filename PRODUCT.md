---
mode: mvp
routing_profile: cloud
parallel_default: parallel
---

# Lixto — proactive agent mode (cycle 19)

## What / why
Today Lixto only answers when asked. The vision (§12) is the other half: every newly ingested procurement is evaluated against every company profile, the good ones become tracked opportunities, the best get a GO/NO-GO recommendation, and the user opens Lixto to "Analisei 137 novas oportunidades hoje. 23 combinam com sua empresa. 5 merecem atenção." This cycle builds that loop on the agent-core tables created in cycle 18 (`opportunities`, `matches`, `recommendations`, `opportunity_feedback`, `agent_runs`) — no schema changes.

1. **Batch match** (`lixto match run`, scheduled after enrichment). For each company with a profile or CNAEs, score procurements enriched since the last run with the *same* scoring rule the chat uses (one implementation, not two), persist a `matches` row, and upsert an `opportunities` row: score ≥ 70 → `state='matched'` and flagged "deserves attention", 40–69 → `matched`, below → not created. Only open/upcoming procurements; reruns idempotent (one match row per company × procurement × engine version).
2. **Bounded GO/NO-GO** (`lixto recommend run`). For each company, the top 5 new opportunities per day with score ≥ 70 get a Tier-3 recommendation (`recommendations`: go / no_go / borderline + rationale in Portuguese + confidence) built from enrichment (requirements, risks, delivery, ME/EPP), company profile, CNAEs and the kinds of habilitação documents the company has uploaded. Cap is a hard limit per company per day; failures never block the digest.
3. **In-app daily digest.** `/lixto` opens with a system-authored message summarizing the last run (new / matched / attention counts) followed by the attention cards (score, reasons, recommendation verdict when present); `/dashboard` gets an "Oportunidades de hoje" card linking to the same list. A new `/opportunities` page lists the company's opportunities by state/score. No email in this cycle.
4. **Feedback capture.** Each opportunity card offers "Tenho interesse" and "Descartar" (with a short reason). These write `opportunity_feedback` and move the `opportunities.state` (`analyzed`/`dismissed`); dismissed ones leave the digest. The chat tools expose the same data (`list_opportunities`, `explain_opportunity`) so "por que essa?" works conversationally.

Guardrails from the vision: process once globally (enrichment) → per-company matching is cheap and deterministic; LLM only for the capped GO/NO-GO; every run recorded in `agent_runs`; nothing executes on the user's behalf.

## Primary user story
As a user of a company with a filled profile, when I open Lixto in the morning I see how many new procurements were analyzed, which ones match my company and the handful that deserve attention — each with a score, reasons and, for the top ones, a GO/NO-GO with rationale — and I can mark interest or dismiss them without touching filters.

## Out of scope
- Email/WhatsApp/push notifications (next cycle)
- Prepare/execute actions, approval workflow
- Learning from feedback (ranking changes) — only capture
- Enabling prod ingestion schedules (user decision, separate)
- Per-page watermark for plans sync; plans/contracts in matching
- Query-time semantic search; streaming chat

## Success demo
Done when, on a DB with enriched procurements and a company profile, `lixto match run` then `lixto recommend run --limit 5` populate `matches`, `opportunities` and `recommendations`, and opening `/lixto` shows the digest message with attention cards carrying score, reasons and a GO/NO-GO verdict, "Descartar" removes a card and writes `opportunity_feedback` — with pytest, vitest and `next build` green.
