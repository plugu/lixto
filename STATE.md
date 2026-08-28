# STATE — rewrite after every ticket completes; never append. ≤30 lines total.

## Now
- Cycle 21 (cost-fenced go-live, mvp): plan approved (1/2). Tickets 100 (llm providers, opus), 101 (fence+details+backfill, sonnet), 104 (web embed dims, haiku) running in parallel worktrees ../lixto-wt-{100,101,104} on branches forge/{100,101,104}. 102, 103, 105, 106 todo.

## Next
- Merge 100/101/104 into main (from main checkout) → 102 → {103 ∥ 105} → 106 → diff summary (approval 2/2).
- Ops after 106 (user OK'd running directly in prod): Dokploy env on lixto-cli + lixto-web — Gemini key from `.llm_keys` (GEMINI_API_KEY, prefix AQ.A — verify it works on the OpenAI-compat endpoint), OpenAI key from `~/dev/hackaview/.env` as fallback, base URL `https://generativelanguage.googleapis.com/v1beta/openai/`, models flash-lite/flash/embedding-001, fence top-3 portals + modalities 6,8, cap 1500; deploy both apps; `lixto backfill --days 45 --max-details 0`; `enrich run` to first cap; enable schedules sync-incremental → enrich-run → enrich-embed → match-run → recommend-run; `lixto status` shows cost.
- Cycle 22 candidates: notifications (WhatsApp via Evolution); deep analysis (rung 2); more Tier-0 fields + doc-checklist enum; metadata-only/lazy edital read if cost > estimate.

## Decisions
- Cycle 21 dispatch: parallel worktrees ×3 for {100,101,104}, then sequential/paired.
- Cycle 21: list ingestion unfenced; details + enrichment fenced by env (`LIXTO_FENCE_PORTALS/MODALITIES/OPEN_ONLY`); hard `LIXTO_ENRICH_DAILY_CAP=1500` counting all enrichment rows today; Gemini primary for all tiers, OpenAI fallback provider per call (embeddings never fall back); PDF via chat-completions `file` parts; ME/EPP flags derived from `procurement_items.benefit_type_id` at enrichment-write time, removed from LLM schema; no DDL.
- Legacy DB is reference only (volume stats), never a data source.
- Cycle 20: hybrid search = FTS ∪ pgvector top-200 (≥0.4), RRF k=60; facets keyword-only.
- Cycle 19: single scoring implementation behind `/api/internal/*`; thresholds 40/70; GO/NO-GO cap 5/company/day.
- `vector` extension NOT trusted in pgvector image → superuser creates it per DB before `lixto db init`.
- Legacy app kept reachable until decommission approved; lixto.com.br → lixto-web.

## Blockers
- none.
