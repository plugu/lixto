---
id: 130
status: done
model: haiku
depends_on: [125, 129]
max_attempts: 3
files:
  - .env.example
  - web/.env.example
  - README.md
  - CLAUDE.md
  - docs/ARCHITECTURE.md
  - docs/VISION.md
  - docs/DATA_MODEL.md
---
## Goal
Document the Radar: new env vars, CLI commands, tables, schedules, and the V1 scope, so operators can enable it in Dokploy without reading tickets.

## Context
Cycle 24 shipped (PRODUCT.md): migration `005_radar.sql` (tables `plan_item_embeddings`, `future_opportunities`, `future_opportunity_matches`, `future_opportunity_actions`, `future_opportunity_analyses`), `lixto plans embed`, `lixto radar run` → `POST /api/internal/radar/run`, web routes `/radar` and `/radar/[id]`.

Env vars to add (Python side in `.env.example`, web side in `web/.env.example`, both in the CLAUDE.md table with one-line purpose + example): `LIXTO_RADAR_HORIZON_DAYS` (365), `LIXTO_RADAR_EMBED_LIMIT` (0 = unlimited), `LIXTO_RADAR_WEIGHT_PCA_ITEM` (50), `LIXTO_RADAR_WEIGHT_DATE_NEAR` (30), `LIXTO_RADAR_WEIGHT_DATE_MID` (15), `LIXTO_RADAR_WEIGHT_RECENT_UPDATE` (20), `LIXTO_RADAR_ANALYSIS_MODEL` (falls back to `LIXTO_RECOMMEND_MODEL`), `LIXTO_RADAR_ANALYSIS_DAILY_CAP` (20). Read the actual defaults from `web/lib/radar-engine.ts`, `web/lib/radar-analysis.ts`, `src/lixto/cli/plans.py` — do not trust this list over the code.

CLAUDE.md: in "Schedules on `lixto-cli`" flip `plans-sync` to enabled (`0 4 * * *`) and add `plans-embed` — `20 4 * * *` (`lixto plans embed`) and `radar-run` — `40 4 * * *` (`lixto radar run`); note these are created/enabled in Dokploy by the operator at deploy time (ops, like every other schedule). Add Key Code Locations rows: Radar engine/batch (`web/lib/radar-*.ts`), Radar routes (`web/app/(app)/radar/*`), plan-item embeddings (`src/lixto/enrich/plan_embed.py`). Add `005_radar.sql` next to the schema row. Under "Lixto Core" add a short "Radar (cycle 24)" subsection: two separate scores, deterministic why, on-demand AI, `status` lifecycle with `procurement_found` reserved for V2.

README.md: CLI reference gains `lixto plans embed` and `lixto radar run`; env table gains the vars above.
docs/ARCHITECTURE.md: new "Future Procurement Radar" section with the pipeline `plans sync → plans embed → radar run (detect+expire → per-company match) → /radar UI → on-demand analysis`.
docs/DATA_MODEL.md: the five tables, column-by-column, in the existing format; call out that `future_opportunities` has no FK to `procurement_plan_items` and why (items are replaced delete+insert on plan update).
docs/VISION.md: mark Radar V1 implemented in cycle 24; list V2 (history, expiring contracts, linker/lead-time badge, clustering) and V3 (price registration, price intelligence, preparation) as roadmap.

## Checks (run in order — cheapest first)
1. `grep -c "LIXTO_RADAR_HORIZON_DAYS" .env.example web/.env.example CLAUDE.md README.md | grep -v ":0"`
2. `grep -n "radar-run\|plans-embed" CLAUDE.md`
3. `grep -n "future_opportunities" docs/DATA_MODEL.md docs/ARCHITECTURE.md`
4. `! grep -rn "Disponível em breve" web/app/\(app\)/radar`

## Done when
- Every `LIXTO_RADAR_*` var read anywhere in `src/` or `web/lib` appears in the env examples and the CLAUDE.md table; schedules and CLI commands are documented; DATA_MODEL covers the five tables.

## Not included
- Creating the Dokploy schedules or setting prod env (ops at deploy time).
- Editing historical tickets or `graphify-out/`.
