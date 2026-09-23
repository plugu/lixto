# STATE — rewrite after every ticket completes; never append. ≤30 lines total.

## Now
- Cycle 30 (case agent V1, **mvp**): 168–173 done (1 attempt each); awaiting approval 2 of 2 + deploy.
- Cycle 29: deployed; 167 follow-ups still open. Cycle 28: prod `grant-superadmin` still to run.

## Next
- After 173 approval: commit + push (autoDeploy); `lixto db init` runs on `lixto-cli` deploy; enable `cases-run` + `results-sync` in Dokploy; never run `scripts/dev/*.sql` in prod.
- Concierge check: verify a real GO case works end-to-end (verdict, email, decision, outcome).
- Carry-over: 167 (static shell ADR for `/`, `Vary: Cookie`, React `cache()` on `getSession`); 162 review follow-ups; DMARC tighten; CNAE cleanup; Gemini billing; Radar schedules OFF; `analyze-run` OFF; restart `plugu-clientes-db-1`.

## Decisions
- Execution: sequential, in place, on `main`.
- Zero LLM per case; new tables only (migration 008); opportunity state untouched except "Não vou" → dismissed.
- Batch steps in order: create → compute verdict → email → request results → resolve outcome. `agent_runs.kind = 'cases'`.
- Outcome from PNCP results `RESULTS_DELAY_DAYS = 2` after the session; operator may set disqualified.
- Case email: transactional (no List-Unsubscribe); bundle zips only non-expired documents (`fflate@0.8.2`).
- Verdict: four statuses (met, expiring, missing, manual); four checkable categories (legal, fiscal_labor, economic_financial, technical).

## Blockers
- None.
