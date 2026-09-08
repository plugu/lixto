# STATE — rewrite after every ticket completes; never append. ≤30 lines total.

## Now
- Cycle 24 (Future Procurement Radar V1, **mvp**) DEPLOYED 2026-09-08 13:23 UTC (`320ad04`, rebased onto cycle 25; suites green post-rebase: ruff, pytest 493, eslint, vitest 619, next build). Migration 005 applied on prod; manual `radar-run` → 200, runId 253, zeros (no PCA rows, no company profiles yet). Dokploy schedules created, ALL OFF by user decision (LLM provider/model undecided, no spend): `plans-sync`, `plans-embed` (`--limit 2000`), `radar-run`, `radar-seed` (manual chain). Go-live runbook in README → "Radar go-live".
- Cycle 25 (AI Tender Analysis V1, **mvp**) DEPLOYED 2026-09-08: migration 006, `analyze-jobs` `*/2 * * * *` enabled; `analyze-run` cron stays DISABLED by decision (2026-09-08) — analysis is on-demand only.

## Next
- Radar go-live blocked on user: pick LLM provider/model (embed model must equal the one `enrich-embed` already uses), decide PCA volume (~65k rows/day nationwide), then follow README "Radar go-live" (seed → enable plans-sync → radar-run; plans-embed optional). Prod needs a company profile before matches appear.
- Kept ENABLED by user (2026-09-08): `analyze-jobs`, `enrich-embed`, `recommend-run`. Only the Radar jobs wait on the provider decision.
- Cycle 25 follow-ups: verify migration 006 on prod; smoke-test "Analisar com IA" on one open procurement. Do not enable `analyze-run` without the user.
- Radar V2 candidates: prediction linker (`procurement_found` + lead-time badge), history/expiring-contract signals, agency+PDM clustering, digest inclusion, 👍/👎 feedback.
- App-wide caveat: `notFound()` streams as HTTP 200 because of `app/loading.tsx` (UI correct) — own ticket if 404 status matters.
- Cycle 21/22 follow-ups unchanged: DMARC tighten, CNAE cleanup, Gemini billing.

## Decisions
- execution: sequential (in place; Radar on branch `cycle-24-radar`, tender analysis was in worktree)
- Cycle 24 Radar: scoring lives in web app, CLI is a thin HTTP trigger (same as match); `future_opportunities` has no FK to plan items (items replaced on plan update); two separate scores (opportunity vs company match, `RADAR_MATCH_MIN=40`); LLM only on demand, cached per opportunity×company, per-company daily cap 20.
- Cycle 25: one deep pass replaces `enrich run`; facet tables kept; dossier in `006_tender_analysis.sql`; `LIXTO_ENRICH_DAILY_CAP` name kept for the cron cap, on-demand jobs capped per company (`LIXTO_ANALYZE_USER_DAILY_CAP`); document-set hash = one SQL shared by Python and TS.
- Dev probe fixtures (gitignored / dev DB only): `web/.env.local` internal token + Gemini key + `LIXTO_RADAR_ANALYSIS_MODEL=gemini-3.7-flash`; session cookie `devprobe` for user 1; company 1 profile terms `{limpeza}`; one radar analysis row for opp 171.
- Legacy DB is reference only. `vector` extension needs superuser per DB before `lixto db init`.

## Blockers
- none.
