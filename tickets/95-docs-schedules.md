---
id: 95
status: todo
model: haiku
depends_on: [92, 93, 94]
max_attempts: 3
files:
  - README.md
  - docs/ARCHITECTURE.md
  - docs/DATA_MODEL.md
  - docs/VISION.md
  - AGENTS.md
---
## Goal
Docs describe proactive mode: batch match, recommendations, digest, feedback, the internal endpoints, env and schedules.

## Context

Ground in code: `web/lib/match-batch.ts`, `recommend.ts`, `opportunity-queries.ts`, `digest-queries.ts`, `web/app/api/internal/**`, `src/lixto/cli/{match,recommend}.py`, `src/lixto/internal_api.py`, `.env.example`. Facts: thresholds 40/70, cap 5 recommendations/company/day, `MATCH_ENGINE_VERSION`, env `LIXTO_INTERNAL_TOKEN` (web + cli), `LIXTO_WEB_INTERNAL_URL`, `LIXTO_RECOMMEND_MODEL`; Dokploy schedules on lixto-cli (created by the orchestrator after this cycle, **disabled**): `match-run` `0 8,15,22 * * *` → `lixto match run`; `recommend-run` `15 8 * * *` → `lixto recommend run`. Update `docs/VISION.md` appendix: proactive mode, GO/NO-GO (bounded), feedback capture now built; `matches`/`opportunities`/`recommendations`/`opportunity_feedback` written. `docs/DATA_MODEL.md`: those four tables are no longer placeholders. `docs/ARCHITECTURE.md`: new section "Proactive loop" with the pipeline and the internal-endpoint design (single scoring implementation).

## Checks (run in order — cheapest first)
1. `grep -q "lixto match run" README.md && grep -q "lixto recommend run" README.md`
2. `grep -q "LIXTO_INTERNAL_TOKEN" README.md && grep -q "api/internal/match/run" docs/ARCHITECTURE.md`
3. `grep -q "match-run" README.md`
4. `! grep -n "Placeholder tables" docs/DATA_MODEL.md`

## Done when
- README/ARCHITECTURE/DATA_MODEL/VISION reflect the shipped proactive loop.

## Not included
- Creating the Dokploy schedules (orchestrator step); email.
