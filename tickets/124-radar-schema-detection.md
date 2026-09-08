---
id: 124
status: done
model: opus
depends_on: []
max_attempts: 3
files:
  - migrations/005_radar.sql
  - web/lib/radar-engine.ts
  - web/lib/radar-engine.test.ts
  - web/lib/radar-batch.ts
  - web/lib/radar-batch.test.ts
  - web/app/api/internal/radar/run/route.ts
---
## Goal
`POST /api/internal/radar/run` turns in-horizon PCA items into scored `future_opportunities` rows (and expires stale ones), on a new migration that also holds every other Radar table.

## Context
Cycle 24 Radar MVP V1 (PRODUCT.md). Cycle-18 tables are never altered (ADR 001) — everything new goes in `migrations/005_radar.sql` (plain SQL, applied by `lixto db init`; header comment style as `migrations/003_email.sql`). Create **all five** tables now so later tickets need no migration:

```sql
CREATE TABLE plan_item_embeddings (
    plan_id BIGINT NOT NULL, item_number INTEGER NOT NULL,
    model TEXT NOT NULL, embedding vector(1536) NOT NULL, embedded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (plan_id, item_number),
    FOREIGN KEY (plan_id, item_number) REFERENCES procurement_plan_items (plan_id, item_number) ON DELETE CASCADE);
CREATE INDEX idx_plan_item_embeddings_hnsw ON plan_item_embeddings USING hnsw (embedding vector_cosine_ops);

CREATE TABLE future_opportunities (      -- one row per PCA item in horizon; survives item replacement
    id BIGSERIAL PRIMARY KEY,
    plan_id BIGINT NOT NULL REFERENCES procurement_plans (id) ON DELETE CASCADE,
    item_number INTEGER NOT NULL,           -- NO FK to plan items: sync_plans replaces items delete+insert
    agency_tax_id CHAR(14) NOT NULL REFERENCES agencies (tax_id),
    state CHAR(2),                          -- resolved from agency_units; NULL = unknown
    title TEXT NOT NULL,                    -- snapshot of item description
    pdm_code TEXT, category_name TEXT,
    estimated_value NUMERIC(18,2),          -- snapshot total_value
    expected_date DATE,                     -- snapshot desired_date
    plan_year INTEGER NOT NULL,
    opportunity_score INTEGER NOT NULL,
    signals JSONB NOT NULL,                 -- [{code, weight, detail}]
    status TEXT NOT NULL DEFAULT 'predicted' CHECK (status IN ('predicted','procurement_found','expired')),
    detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    engine_version TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (plan_id, item_number));
-- indexes: (status, expected_date); (agency_tax_id); (state);
--          gin (to_tsvector('portuguese', f_unaccent(title))) — same expression as procurement_plan_items FTS

CREATE TABLE future_opportunity_matches (company_id FK companies CASCADE, future_opportunity_id FK future_opportunities CASCADE,
    match_score INTEGER NOT NULL, reasons JSONB NOT NULL, engine_version TEXT NOT NULL,
    computed_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (company_id, future_opportunity_id));
-- index (company_id, match_score DESC)
CREATE TABLE future_opportunity_actions (company_id, future_opportunity_id (same FKs), state TEXT NOT NULL CHECK (state IN ('saved','ignored')),
    user_id BIGINT REFERENCES users (id) ON DELETE SET NULL, created_at, updated_at, PRIMARY KEY (company_id, future_opportunity_id));
CREATE TABLE future_opportunity_analyses (id BIGSERIAL PRIMARY KEY, company_id, future_opportunity_id (same FKs),
    model TEXT NOT NULL, content JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (company_id, future_opportunity_id));
```

**`web/lib/radar-engine.ts`** (pure, no I/O; model on `web/lib/match-engine.ts`): `RADAR_ENGINE_VERSION = "1"`; `type Signal = { code: SignalCode; weight: number; detail: string }` with `SignalCode = "pca_item" | "date_near" | "date_mid" | "date_far" | "recent_plan_update"`; `type RadarWeights = { pcaItem; dateNear; dateMid; recentUpdate }`; `DEFAULT_WEIGHTS = { pcaItem: 50, dateNear: 30, dateMid: 15, recentUpdate: 20 }`; `loadWeights(env = process.env)` reading `LIXTO_RADAR_WEIGHT_PCA_ITEM`, `_DATE_NEAR`, `_DATE_MID`, `_RECENT_UPDATE` (invalid → default); `scoreOpportunity(facts: { expected_date: string|null; plan_updated_at: string|null }, now: Date, w = DEFAULT_WEIGHTS): { score, signals }` — always `pca_item`; `date_near` if expected within 0–90 days, `date_mid` 91–180, `date_far` weight 0 otherwise (detail says why); `recent_plan_update` if plan `source_global_updated_at` within 60 days. Clamp 0–100. Copy in the detail strings must be pt-BR and use "previsto/estimado", never "confirmado".

**`web/lib/radar-batch.ts`**: `runRadarBatch(): Promise<{ runId, opportunities, expired }>` (company matching is ticket 126 — leave a documented hook, don't build it). Follow `web/lib/match-batch.ts` for `agent_runs` start/finish (kind `'radar'`, free text). Steps, each its own SQL with bound params via `pool` from `./db` (relative imports in `lib/`):
1. Horizon select, keyset-paged by `(p.id, i.item_number)` in pages of 500: `procurement_plan_items i JOIN procurement_plans p ON p.id = i.plan_id` where `p.year >= extract(year from current_date)`, `(i.desired_date IS NULL OR (i.desired_date >= current_date AND i.desired_date <= current_date + $horizon))`, `coalesce(i.description,'') <> ''`. Horizon days from env `LIXTO_RADAR_HORIZON_DAYS` (default 365). State: `LEFT JOIN agency_units u ON u.agency_tax_id = p.agency_tax_id AND u.code = p.unit_code`, fallback `(SELECT state FROM agency_units WHERE agency_tax_id = p.agency_tax_id GROUP BY state ORDER BY count(*) DESC LIMIT 1)`.
2. Score each row in TS; multi-row `INSERT ... ON CONFLICT (plan_id, item_number) DO UPDATE SET` snapshot cols, `state`, `opportunity_score`, `signals`, `engine_version`, `updated_at = now()`, and `status = 'predicted'` only `WHERE future_opportunities.status = 'expired'` (never touch `procurement_found`; `detected_at` untouched).
3. Expire: `UPDATE future_opportunities SET status='expired', updated_at=now() WHERE status='predicted' AND (expected_date < current_date OR NOT EXISTS (SELECT 1 FROM procurement_plan_items i WHERE i.plan_id = plan_id AND i.item_number = item_number))`.

**Route** `web/app/api/internal/radar/run/route.ts`: copy `web/app/api/internal/match/run/route.ts` (guard `isInternalRequest`, `maxDuration = 300`); body `{ companyId? }` parsed now and passed through as `runRadarBatch({ companyId })` (ignored until 126). Errors in pt-BR like the sibling.

Tests: `radar-engine.test.ts` (weights, bands, clamp, env parsing); `radar-batch.test.ts` mocking `./db` as in `web/lib/match-batch.test.ts` — assert paging terminates, upsert binds snapshot values, expiry SQL runs, `agent_runs` finished `done`/`failed`.

## Checks (run in order — cheapest first)
1. `cd web && npm run lint`
2. `cd web && npx vitest run lib/radar-engine.test.ts lib/radar-batch.test.ts`
3. `cd web && npm run build`
4. `cd web && npm test`
5. `psql "$LIXTO_DATABASE_URL" -c "\d future_opportunities" | grep -c "plan_id"` (after `uv run lixto db init` on the dev docker-compose DB)

## Done when
- `uv run lixto db init` applies `005_radar.sql` cleanly on a DB that already has 001–004.
- With PCA rows in the dev DB (`uv run lixto plans sync --since <last 7 days>`), `curl -s -X POST -H "x-lixto-internal-token: $LIXTO_INTERNAL_TOKEN" localhost:3000/api/internal/radar/run` returns `{runId, opportunities, expired}` with `opportunities > 0`, and `SELECT count(*) FROM future_opportunities WHERE status='predicted'` matches; a second call is idempotent (same count, `detected_at` unchanged).

## Not included
- Company matching / `future_opportunity_matches` writes (ticket 126).
- Python CLI trigger and plan-item embeddings job (ticket 125).
- Any UI, docs, or schedule changes.
- `procurement_found` transitions (V2 linker).
