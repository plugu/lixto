# STATE — rewrite after every ticket completes; never append. ≤30 lines total.

## Now
- Cycle 26 (ML-instead-of-LLM facet benchmark, **prototype**, `experiments/ml-facets/`): 139 (local e5 embeddings + bench.py → REPORT.md) — doing, sonnet, attempt 1. 138 DONE: cnae top-3 0.355, categories micro-F1 0.031 (5,995 free-form categories — open vocabulary), flags F1 0.703/0.679, complexity macro-F1 0.461, keywords Jaccard 0.035 (YAKE) → all below thresholds; label volume (930 cloud rows) + open vocabularies are the limits. 137 DONE: 10 CSVs in `experiments/ml-facets/data/` (gitignored), WARNING 930 cloud rows; `profiles.csv` empty (no prod profiles) → 139 profile metric informational only.
- Prod label inventory (2026-09-08): enrichments done 3,960 = lixto-qwen 3,030 (local, CNAE ~45% hallucinated) + gpt-5-mini 563 + gemini-3.5-flash-lite 366 + gemini-3.7-flash 1 → ~930 cloud rows; cnaes 10,777; categories 12,232; doc_texts>500 chars 5,334; embeddings 2,883; `procurement_items.catalog_code` NULL everywhere.

## Next
- ML facets: keep LLM. Revisit only if (a) a canonical category taxonomy replaces free-form `categories`, (b) ≥5k cloud-labelled rows exist, or (c) embeddings move to a local model wholesale (full re-embed; overlap-vs-OpenAI then irrelevant, judge by profile-query quality instead).
- Another session is planning cycle 27 (tickets 140–152, `PRODUCT.next.md`) in this checkout — do not touch.
- Cycle 24 Radar DEPLOYED (`320ad04`), all 4 Radar schedules OFF until LLM provider decision; runbook README "Radar go-live". Prod has no company profile yet.
- Cycle 25 tender analysis DEPLOYED; `analyze-run` cron stays OFF by decision; `analyze-jobs`, `enrich-embed`, `recommend-run` stay ON by user.
- Older follow-ups: `notFound()` streams HTTP 200 (`app/loading.tsx`); DMARC tighten; CNAE cleanup; Gemini billing.

## Decisions
- execution: sequential (in place, on `main`)
- Cycle 26: throwaway code under `experiments/ml-facets/` with PEP 723 inline deps; `src/`, `web/`, pyproject untouched. Train on all labelled rows (CNAE: cloud only), evaluate on cloud-labelled held-out only. Thresholds: CNAE top-3 ≥0.80, categories/flags/complexity F1 ≥0.80, keywords Jaccard ≥0.50, embeddings top-10 overlap ≥0.70.
- VPS access: Tailscale SSH check-mode — user must run `! ssh plugu-prod01 true` and open the URL; window ~12h. Prod PG via `docker exec $(docker ps -qf name=pg-shared) psql -U shared -d lixto` (peer auth, no password on the command line).
- Cycle 24: scoring in web app, CLI thin trigger; `future_opportunities` no FK to plan items; two separate scores; LLM on demand, cached. Cycle 25: dossier in 006; on-demand analysis capped per company.
- Dev probe fixtures (gitignored / dev DB): `web/.env.local` internal token + Gemini key; cookie `devprobe`; company 1 terms `{limpeza}`.

## Blockers
- none.
