---
mode: mvp
routing_profile: cloud
parallel_default: parallel
---

# Lixto — cost-fenced go-live (cycle 21)

## What / why
Cycles 18–20 built the whole pipeline (sync → enrich → match → recommend → digest → semantic search) but production has never ingested a row: all schedules are disabled and no LLM key is set. The blocker is cost uncertainty — enrichment is the only LLM spend, and today `lixto enrich run` would spend on every open procurement from 257 portals (~6,300/day nationally, ~$12/1k on OpenAI). This cycle turns production on with the spend fenced by construction, all data coming from PNCP ingestion (nothing from the legacy database).

1. **Ingest everything, enrich a fence.** `sync incremental` keeps pulling all portals/modalities (HTTP + storage only). Details (items/documents) and enrichment run only for the **fence**: `origin_system` in top-3 portals (Compras.gov.br, ECustomize, IPM Sistemas), modality 6 (Pregão eletrônico) or 8 (Dispensa), and open/upcoming (`proposal_closes_at >= now() OR proposal_opens_at > now()`). Fence is config (env), not code.
2. **45-day backfill from today backwards.** `lixto sync backfill --days 45` pages `/contratacoes/publicacao` per fenced modality, then details + enrichment drain the fenced open set closing-soonest first. Legacy run-rate says ≈ 8–10k rows one-off, ≈ 1,500/day after.
3. **Hard daily cap + usage.** `LIXTO_ENRICH_DAILY_CAP=1500` rows/day across all runs; when reached the run stops and says so. Every LLM call records prompt/completion tokens, model and estimated USD in `agent_runs` counters; `lixto status` shows today's enriched / cap / tokens / est. $. Cap can't be exceeded by scheduling more runs.
4. **Gemini for all tiers, OpenAI fallback.** Primary provider Gemini via the OpenAI-compatible endpoint: cheap = `gemini-2.5-flash-lite`, doc/strong = `gemini-2.5-flash`, embed = `gemini-embedding-001` at 1536 dims. Doc tier moves off the OpenAI Responses API to chat completions with inline PDFs. A second provider (`LIXTO_LLM_FALLBACK_BASE_URL/API_KEY/MODEL_*`) is used per call when the primary errors; embeddings never fall back across providers (vectors must share one model). Keys are an operator step at run time (Gemini key to be supplied; OpenAI key from hackiv's Dokploy env).
5. **Tier-0 ME/EPP from items.** `me_epp_exclusive` / `me_epp_preference` derive deterministically from `procurement_items.benefit_type_id` (PNCP `tipoBeneficio`: 1 exclusive, 2 subcontracting, 3 reserved quota) when the enrichment row is written (same tables, no DDL); the LLM schema drops those two fields. Match engine and recommendations read the derived values.
6. **Enable schedules** in order: sync-incremental → enrich-run → enrich-embed → match-run → recommend-run; plans/contracts stay disabled.

## Primary user story
As the operator, I turn ingestion on and know that Lixto will enrich at most 1,500 fenced open procurements per day on Gemini, see today's spend in `lixto status`, and within 24 h a test company's digest shows real opportunities — without ever touching the legacy database.

## Out of scope
- Plans/contracts sync (per-page watermark), results sync enablement
- Notifications (email/WhatsApp), prepare/execute, learning loop
- Metadata-only / two-stage enrichment (edital read at recommend time)
- Other Tier-0 fields (lot structure, deadline pressure, judging criterion), doc-checklist enum, schema v1.1
- Mistral OCR or any provider beyond Gemini + OpenAI fallback
- Local/Ollama lane

## Success demo
Done when schedules are enabled in Dokploy and, 24 h later, `lixto status` in prod shows fenced open procurements enriched on Gemini with tokens and estimated $ under the 1,500/day cap, a test company's `/lixto` digest lists real opportunities, and their ME/EPP flags come from `benefit_type_id` rather than the LLM.
