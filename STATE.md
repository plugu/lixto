# STATE — rewrite after every ticket completes; never append. ≤30 lines total.

## Now
- Cycle 27 (App fluidity, **mvp**, `web/`): plan approved 2026-09-08 (approval 1 of 2). 140 DONE (1 attempt). 141 (route skeletons) — doing, sonnet. Tickets 141→152 sequential.
- Cycle 26 (ML facet benchmark) CLOSED `ccfb5a7`: all targets NO-GO (label volume 930 cloud rows + open vocabularies). Keep LLM for facets. Embeddings DECIDED 2026-09-08: stay on `gemini-embedding-001` (MTEB-BR #1; 3-small cheaper but weaker); user enabling Gemini billing.

## Next
- 140 → 141 → 142 → 143 → 144 (opus) → 145 → 146 → 147 → 148 → 149 (opus) → 150 → 151 → 152. {147, 148} disjoint from the 141→146 chain if parallel wanted.
- After 152: `graphify update .`, deploy `lixto-web` (Dokploy autoDeploy on push), browser walkthrough per PRODUCT.md success demo.
- Cycle 24 Radar schedules OFF; unblock = Gemini billing on → README "Radar go-live" steps 1–5 (PCA volume decision, seed, enable); cycle 25 `analyze-run` cron OFF by decision.
- Older follow-ups: DMARC tighten; CNAE cleanup; Gemini billing. (`notFound()` streams 200 → fixed by ticket 141.)

## Decisions
- execution: sequential (in place, on `main`)
- Cycle 27: URL contracts frozen (`parseFilters`, `parseRadarFilters`, `parseChartScope`, `?view=`); nuqs only for pill tabs (comma-joins arrays), repeated-key filters via custom hooks in `lib/procurement-url.ts` / `lib/radar-url.ts`; view transitions via `next-view-transitions@0.3.5` (Next 16.3 has no native flag); no worker/migration changes; vitest node-only → UI verified by lint/build/curl with `lixto_session=devprobe`.
- VPS access: Tailscale SSH check-mode — user runs `! ssh plugu-prod01 true`; prod PG via `docker exec $(docker ps -qf name=pg-shared) psql -U shared -d lixto`.
- Dev probe fixtures (gitignored / dev DB): `web/.env.local` internal token + Gemini key; cookie `devprobe`; company 1 terms `{limpeza}`.

## Blockers
- none.
