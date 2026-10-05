# STATE — rewrite after every ticket completes; never append. ≤30 lines total.

## Now
- Cycle 32 (classification at ingest, **mvp**): approved, `31a17b1` + `1f23184` deployed 2026-10-04 (web + cli). Prod rollout 2026-10-05: migration 009 (applied by the cli container's boot `db init`), `cnae seed` 1332, `classify embed-labels` 1332+24 OK, `sync-incremental` now ends with `; lixto classify run`, `classify-backfill` (5000/run, ~1.3 s each) started 15:55 UTC.
- Cycle 31 (cache): shipped `7850d08`, prod verified 2026-09-28.

## Next
- Backfill: read the `classify-backfill` schedule log in Dokploy; re-run until `lixto status` shows `pending: 0` (each run ≤5000, ~1h50).
- Owner review: `lixto classify export --limit 100` in the cli container + `docker cp`; targets ≥80% CNAE top-1, ≥90% segment.
- Verify `/opportunities` shows `cnae_primary`/`cnae_secondary` after the next `match-run` (08/15/22 BRT); `/procurements?segment=informatica` filters.
- Dokploy also changed 2026-10-05: `cases-run` CREATED (`45 8,20 * * *`, enabled; first real run of the case agent), `results-sync` ENABLED. Watch `lixto status` email/cases blocks and LLM spend.
- Uncommitted: `claude_product_analysis.md`. Scraper token-reuse branch still untested.
- Carry-over: 167 (static shell ADR, `Vary: Cookie`); 162 follow-ups; DMARC; Gemini billing; Radar schedules OFF; `analyze-run` OFF; restart `plugu-clientes-db-1`.

## Decisions
- Classification: cosine NN candidates (15 CNAE + 6 segment) → one CHEAP LLM choice (≤3 CNAEs, 1 segment, 1 nature, ≤10 keywords).
- Closed 24-segment taxonomy seeded by migration 009, synced with code by test.
- Keywords on `procurement_classifications`; dossier CNAE wins on shared code (not overwritten).
- `MATCH_ENGINE_VERSION` = 2; `term_enrichment` reads dossier + ingest keywords; match keyed on `signalsSince`.
- Comprasnet scraper shipped as operator-only tool, hCaptcha manual solve.

## Blockers
- None.
