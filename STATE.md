# STATE — rewrite after every ticket completes; never append. ≤30 lines total.

## Now
- Cycle 18 (Lixto core from zero: English schema, rename, PCA + contracts), production mode. PRODUCT approved (1/3). Plan written: ADR docs/adr/001-lixto-data-model.md + tickets 74–86. Awaiting plan approval (2/3).

## Next
- /forge:run cycle 18: 74 → {75 ∥ 79 ∥ 80} → {76 ∥ 77 ∥ 78 ∥ 81} → 82 → 83 → {84 (orchestrator+user) ∥ 85} → 86 → reviewer pass → approval 3/3.

## Decisions
- Cycle 18: new DB `lixto` (not schema-in-old-DB), zero data migration incl. tenants, plural English table names, raw in `source_payloads`, facet tables for enrichment, agent-core tables created now/written later. Legacy `src/plic` kept until ticket 85 as porting reference. Data pulled only from PNCP (licinexus MCP was reference only, never a dependency).
- pgvector now available (prod image pgvector/pgvector:pg18-trixie — trixie keeps glibc 2.41 so no collation mismatch; bookworm tag briefly ran ~4 min on 2026-08-25 19:33 UTC). Match = CNAE ∩ + term arrays + FTS + cosine bands (≥0.55 +20, ≥0.40 +10).
- Match on-demand in web (no `match` table) — profile edits reflect instantly.
- LLM via OpenAI-compatible env (`PLIC_LLM_*`): Chat Completions for text tiers (portable), Responses API for PDF tier (OpenAI only). Web reuses same env + `PLIC_CHAT_MODEL` (default gpt-5-mini).
- Legacy triage/deep + company_profile.md untouched (still feed Fit badge). Chat non-streaming JSON.
- Repo-wide `ruff format --check` fails on ~16 pre-existing files; checks scoped to new files. Candidate chore: one-shot `ruff format` commit.
- Dispatch: parallel worktrees (2), `cp -Rc` node_modules, merge from main checkout — worked cleanly, zero conflicts.
- Carried: no cron on dev machine; resultados demand-driven.

## Blockers
- none.
