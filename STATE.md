# STATE — rewrite after every ticket completes; never append. ≤30 lines total.

## Now
- Cycle 32 (classification at ingest, **mvp**): tickets 182–187 done, awaiting approval 2 of 2 + deploy.
- Cycle 31 (cache): shipped `7850d08`, prod verified 2026-09-28.

## Next
- Approval 2 of 2 (diff review), commit, push.
- Prod rollout: `lixto db init`, `lixto cnae seed` if empty, `lixto classify embed-labels`, Dokploy `sync-incremental` command += `; lixto classify run`, one backfill `lixto classify run --limit 5000` until pending = 0, `lixto classify export --limit 100` for 100-row owner review (target ≥80% CNAE top-1, ≥90% segment).
- Verify `/opportunities` shows `cnae_primary`/`cnae_secondary` reasons; `/procurements?segment=` filters by segment.
- Uncommitted from this session: `lixto comprasnet scrape` (Camoufox operator tool, token-reuse untested), `claude_product_analysis.md`.

## Decisions
- Classification: cosine NN candidates (15 CNAE + 6 segment) → one CHEAP LLM choice (≤3 CNAEs, 1 segment, 1 nature, ≤10 keywords).
- Closed 24-segment taxonomy seeded by migration 009, synced with code by test.
- Keywords on `procurement_classifications`; dossier CNAE wins on shared code (not overwritten).
- `MATCH_ENGINE_VERSION` = 2; `term_enrichment` reads dossier + ingest keywords; match keyed on `signalsSince`.
- Comprasnet scraper shipped as operator-only tool, hCaptcha manual solve.

## Blockers
- None.
