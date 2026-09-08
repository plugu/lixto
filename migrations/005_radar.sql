-- Ticket 124: Future Procurement Radar (cycle 24).
--
-- Cycle-18 tables are never altered (ADR 001), so every Radar table lives
-- here. All five ship at once — detection (this ticket), plan-item embeddings
-- (125), per-company matches (126), saved/ignored actions and the cached AI
-- analysis (127+) — so no later ticket needs a migration of its own.
--
-- One opportunity = one PCA item (PRODUCT.md): traceable evidence, no
-- clustering. The row is a *snapshot* of the item plus the deterministic
-- signals that produced its score, written by web/lib/radar-batch.ts.

-- Vector for plan items, mirroring `procurement_embeddings` (same model, same
-- 1536 dims, same HNSW/cosine index) so ticket 126 can compare a company
-- profile vector against a plan item with one operator.
CREATE TABLE plan_item_embeddings (
    plan_id      BIGINT NOT NULL,
    item_number  INTEGER NOT NULL,
    model        TEXT NOT NULL,
    embedding    vector(1536) NOT NULL,
    embedded_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (plan_id, item_number),
    FOREIGN KEY (plan_id, item_number)
        REFERENCES procurement_plan_items (plan_id, item_number) ON DELETE CASCADE
);
CREATE INDEX idx_plan_item_embeddings_hnsw ON plan_item_embeddings USING hnsw (embedding vector_cosine_ops);

-- One row per PCA item inside the horizon. Deliberately *no* FK on
-- (plan_id, item_number): `lixto plans sync` replaces a plan's items with a
-- delete+insert, and an opportunity must survive that (its `detected_at` is
-- the whole point — "found N days before publication" is computed from it).
-- The FK on plan_id alone keeps the row anchored to a live plan.
CREATE TABLE future_opportunities (
    id                BIGSERIAL PRIMARY KEY,
    plan_id           BIGINT NOT NULL REFERENCES procurement_plans (id) ON DELETE CASCADE,
    item_number       INTEGER NOT NULL,          -- procurement_plan_items.item_number (no FK, see above)
    agency_tax_id     CHAR(14) NOT NULL REFERENCES agencies (tax_id),
    state             CHAR(2),                   -- resolved from agency_units; NULL = unknown
    title             TEXT NOT NULL,             -- snapshot of procurement_plan_items.description
    pdm_code          TEXT,
    category_name     TEXT,
    estimated_value   NUMERIC(18,2),             -- snapshot of total_value
    expected_date     DATE,                      -- snapshot of desired_date (estimated, never confirmed)
    plan_year         INTEGER NOT NULL,          -- procurement_plans.year
    opportunity_score INTEGER NOT NULL,          -- 0..100, will-it-happen (web/lib/radar-engine.ts)
    signals           JSONB NOT NULL,            -- [{code, weight, detail}] — same shape as matches.reasons
    status            TEXT NOT NULL DEFAULT 'predicted' CHECK (status IN ('predicted','procurement_found','expired')),
    detected_at       TIMESTAMPTZ NOT NULL DEFAULT now(),  -- never rewritten by a rerun
    engine_version    TEXT NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (plan_id, item_number)
);
CREATE INDEX idx_future_opportunities_status_date ON future_opportunities (status, expected_date);
CREATE INDEX idx_future_opportunities_agency ON future_opportunities (agency_tax_id);
CREATE INDEX idx_future_opportunities_state ON future_opportunities (state);
-- Same FTS expression as idx_procurement_plan_items_description_fts, so a
-- keyword filter on the radar list is index-backed.
CREATE INDEX idx_future_opportunities_title_fts ON future_opportunities USING gin (to_tsvector('portuguese', f_unaccent(title)));

-- Per-company deterministic score (ticket 126). Latest state, not history:
-- unlike `matches`, a rerun overwrites — the radar list only ever shows now.
CREATE TABLE future_opportunity_matches (
    company_id             BIGINT NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
    future_opportunity_id  BIGINT NOT NULL REFERENCES future_opportunities (id) ON DELETE CASCADE,
    match_score            INTEGER NOT NULL,     -- 0..100
    reasons                JSONB NOT NULL,       -- [{code, weight, detail}]
    engine_version         TEXT NOT NULL,
    computed_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (company_id, future_opportunity_id)
);
CREATE INDEX idx_future_opportunity_matches_company_score ON future_opportunity_matches (company_id, match_score DESC);

-- Saved / ignored, one choice per company × opportunity (ticket 127).
CREATE TABLE future_opportunity_actions (
    company_id             BIGINT NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
    future_opportunity_id  BIGINT NOT NULL REFERENCES future_opportunities (id) ON DELETE CASCADE,
    state                  TEXT NOT NULL CHECK (state IN ('saved','ignored')),
    user_id                BIGINT REFERENCES users (id) ON DELETE SET NULL,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (company_id, future_opportunity_id)
);

-- Cached "Analisar com IA" result: one LLM call per company × opportunity,
-- ever. Zero spend for items nobody opens (PRODUCT.md).
CREATE TABLE future_opportunity_analyses (
    id                     BIGSERIAL PRIMARY KEY,
    company_id             BIGINT NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
    future_opportunity_id  BIGINT NOT NULL REFERENCES future_opportunities (id) ON DELETE CASCADE,
    model                  TEXT NOT NULL,
    content                JSONB NOT NULL,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (company_id, future_opportunity_id)
);
