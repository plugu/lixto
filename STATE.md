# STATE — rewrite after every ticket completes; never append. ≤30 lines total.

## Now
- Cycle 21 (cost-fenced go-live, mvp): tickets 100–106 done (1–2 attempts each), main green (pytest 361, vitest 415, tsc), pushed b5b6fcc. Prod: env set on lixto-cli + lixto-web (Gemini primary 3.5-flash-lite / 3.7-flash / embedding-001@1536, OpenAI fallback, fence top-3 × modalities 6,8 × open, cap 1500), both redeployed 2026-08-28 03:1xZ. `lixto backfill --days 45 --max-details 0` running detached in lixto-cli (log /tmp/backfill.log; relaunched with LIXTO_MIN_REQUEST_INTERVAL=0.6 — 0.25 caused ~1 in 3 requests to 429 with 30 s cooldowns; still ~1 in 6 at 0.6). Follower in container runs `enrich run --limit 100` + `lixto status` into /tmp/chain.log when backfill exits. Next: first `enrich run --limit 100` cost probe → to cap → enable schedules → approval 2/2.

## Next
- Ops remaining: wait backfill details drain → `enrich run --limit 100` (read usage/$ in `lixto status`) → run to cap → enable schedules sync-incremental → enrich-run → enrich-embed → match-run → recommend-run → smoke digest for a test company.
- Cycle 22 candidates: notifications (WhatsApp via Evolution); deep analysis (rung 2); more Tier-0 fields + doc-checklist enum; metadata-only/lazy edital read if cost > estimate.

## Decisions
- Cycle 21 dispatch: parallel worktrees ×3 for {100,101,104}, then sequential/paired.
- Cycle 21: Gemini 2.5 retired for new keys → 3.5-flash-lite (cheap) / 3.7-flash (doc/strong/chat/recommend); Gemini compat rejects PDF `file` parts → doc tier auto-routes to OpenAI gpt-5-mini after first 400. List ingestion unfenced; details + enrichment fenced by env (`LIXTO_FENCE_PORTALS/MODALITIES/OPEN_ONLY`); hard `LIXTO_ENRICH_DAILY_CAP=1500` counting all enrichment rows today; Gemini primary for all tiers, OpenAI fallback provider per call (embeddings never fall back); PDF via chat-completions `file` parts; ME/EPP flags derived from `procurement_items.benefit_type_id` at enrichment-write time, removed from LLM schema; no DDL.
- Legacy DB is reference only (volume stats), never a data source.
- Cycle 20: hybrid search = FTS ∪ pgvector top-200 (≥0.4), RRF k=60; facets keyword-only.
- Cycle 19: single scoring implementation behind `/api/internal/*`; thresholds 40/70; GO/NO-GO cap 5/company/day.
- `vector` extension NOT trusted in pgvector image → superuser creates it per DB before `lixto db init`.
- Legacy app kept reachable until decommission approved; lixto.com.br → lixto-web.

## Blockers
- none.
