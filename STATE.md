# STATE — rewrite after every ticket completes; never append. ≤30 lines total.

## Now
- Cycle 21 (cost-fenced go-live, mvp) LIVE in prod since 2026-08-28. Tickets 100–106 done (1–2 attempts each); main green (pytest 361, vitest 415, tsc); HEAD b5b6fcc+. Awaiting final review (approval 2/2).
- Prod data: 45-day backfill ingested 115,838 procurements (8 of 91 units failed on PNCP 500/504, retry with `lixto backfill --days 45` later); fenced details drain still running in lixto-cli (≈800 rows/h, ~4.6k of 7.4k fenced open rows left at 12:45Z).
- Cost probe (100 rows, Gemini 3.5-flash-lite, 3 fallbacks to gpt-5-mini): 99 done / 1 error, 1.86M prompt + 68k completion tokens, **US$ 0.72 / 100 rows** (≈ $7/1k). ~1 row/min (Gemini latency + 503 retries) → ~1.2k rows/day sequential.
- Enrichment loop switched 2026-08-28 22:22Z to the user's Mac (Ollama `lixto-qwen` = qwen3.6:35b-a3b-mtp-q4_K_M with num_ctx 32768, reached from lixto-cli at http://100.106.14.40:11434/v1, fallback DISABLED, ~80 s/row ≈ 1k rows/day, US$ 0). Cloud runs today: probe + 2.5 iterations ≈ 920 rows ≈ US$ 6–7; Gemini key is FREE tier (429 quota) so cloud rows went to gpt-5-mini; `reasoning_effort=minimal` shipped (ac15f0d). Local rows persist without embeddings → cloud `enrich-embed` schedule backfills. Schedules enabled: sync-incremental, enrich-embed, match-run, recommend-run. `enrich-run` (cloud) stays DISABLED — user decides Monday. Mac kept awake via caffeinate 60 h.

## Next
- Monday: decide enrich-run (cloud) on/off; enable Gemini billing (paid tier) or stay on gpt-5-mini; rerun `lixto backfill --days 45` for the 8 failed units; `enrich run --retry-errors` on cloud for the pdf-class rows the local model can't read; fix stale "DISABLED" descriptions on match-run/recommend-run; verify a company's `/lixto` digest.
- Follow-up ticket candidates: per-tier base URL (embed on cloud while chat local); CNAE code validation against `cnaes` seed; 30-row local-vs-cloud quality A/B.
- Throughput: 1,500/day cap unreachable at 1 row/min sequential — consider parallel enrich workers or gemini-3.1-flash-lite if the fence grows.
- Cycle 22 candidates: notifications (WhatsApp via Evolution); deep analysis (rung 2); more Tier-0 fields + doc-checklist enum; metadata-only/lazy edital read if cost matters; enrich concurrency.

## Decisions
- Cycle 21: list ingestion unfenced; details + enrichment fenced by env (`LIXTO_FENCE_PORTALS`=top-3 portals, `LIXTO_FENCE_MODALITIES`=6,8, open only); hard `LIXTO_ENRICH_DAILY_CAP=1500` counting all enrichment rows today; Gemini primary (3.5-flash-lite cheap, 3.7-flash doc/strong/chat/recommend, embedding-001@1536), OpenAI fallback per call (gpt-5-mini / gpt-5.1; embeddings never fall back); Gemini compat rejects PDF `file` parts → doc tier auto-routes to OpenAI after first 400; ME/EPP flags from `procurement_items.benefit_type_id`, removed from LLM schema; no DDL. Gemini 2.5 names are retired for new keys.
- PNCP: `LIXTO_MIN_REQUEST_INTERVAL=0.25` (Dokploy env) causes ~1 in 3 requests to 429 with 30 s cooldowns; backfill was relaunched with 0.6 (still ~1 in 6). Consider raising the env default.
- Legacy DB is reference only (volume stats), never a data source.
- Cycle 20: hybrid search = FTS ∪ pgvector top-200 (≥0.4), RRF k=60. Cycle 19: single scoring impl behind `/api/internal/*`; thresholds 40/70; GO/NO-GO cap 5/company/day.
- `vector` extension NOT trusted in pgvector image → superuser creates it per DB before `lixto db init`.

## Blockers
- none.
