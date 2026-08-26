# Lixto Data Model

Complete table reference for the `lixto` database schema (cycle 18). All tables have `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`; mutable tables also have `updated_at`. Money is `NUMERIC(18,2)`; quantities `NUMERIC(18,4)`; percentages `NUMERIC(7,4)`. Enumerations are `TEXT + CHECK` (no PG enums).

## Reference Tables

### `sources`
Raw payload source identifier and metadata.
- **Key**: `id` (TEXT, e.g., 'pncp')
- **Notable columns**: `name`, `base_url`
- **Notable indexes**: PK only
- **Purpose**: Multi-source abstraction; today only 'pncp'. If SEAP or state portals are added, each gets a row.

### `cnae_codes`
IBGE CNAE subclasses, seeded by `lixto cnae seed`.
- **Key**: `code` (CHAR(7), digits only)
- **Notable columns**: `description`, `division` (CHAR(2)), `division_description`
- **Notable indexes**: PK only
- **Purpose**: Reference for enrichment `cnae_candidates` and company/procurement CNAE matching. ~8,800 rows.

### `sync_state`
Watermarks for incremental syncs (one row per source + entity + modality).
- **Key**: `key` (TEXT, e.g., 'incremental:procurements:6', 'incremental:plans', 'incremental:contracts')
- **Notable columns**: `value` (JSONB: timestamp, modality code, error count, etc.)
- **Notable indexes**: PK only
- **Purpose**: Track where each incremental sync stopped; resume on next run.

### `source_payloads`
Raw API responses, retained for reprocessing without re-fetching.
- **Key**: `(source, entity_type, external_id)` compound
- **Notable columns**: `payload` (JSONB, complete DTO or array), `fetched_at`
- **Notable indexes**: PK only
- **Purpose**: Reproducibility and reprocessing. Entity types: 'procurement', 'procurement_items', 'procurement_documents', 'procurement_results', 'procurement_plan', 'contract', 'contract_amendments'.

## Buyers

### `agencies`
Organizational entities (órgãos públicos) that publish tenders.
- **Key**: `tax_id` (CHAR(14), CNPJ digits only)
- **Notable columns**: `name`, `power_code`, `sphere_code`
- **Notable indexes**: PK only
- **Purpose**: Buyer metadata; referenced by procurements, plans, contracts. Upserted on every sync.

### `agency_units`
Sub-units within agencies (unidades orçamentárias) that actually publish.
- **Key**: `(agency_tax_id, code)` compound
- **Notable columns**: `name`, `state`, `city_name`, `ibge_code`
- **Notable indexes**: PK only
- **Purpose**: Geo filter (state/city are denormalized to procurements for hot queries).

## Procurements (Core Tender Data)

### `procurements`
PNCP tender publications.
- **Key**: `id` (BIGSERIAL surrogate)
- **Natural key**: `(source, source_id)` UNIQUE — `source_id` is the PNCP control number (público identifier)
- **Notable columns**: `state`, `city_name` (denormalized from unit), `modality_id`, `status_id`, `estimated_value`, `awarded_value`, `proposal_opens_at`, `proposal_closes_at`, `published_at`, `source_global_updated_at` (incremental watermark), `items_synced_at`, `documents_synced_at`
- **Notable indexes**: `state`, `modality_id`, `published_at`, `proposal_closes_at`, `agency_tax_id`, `source_global_updated_at` (watermark), idx_procurements_details_pending (items/documents missing)
- **Purpose**: Mirror of PNCP procurement notices. ~10M rows in production (across all modalities).

### `procurement_items`
Line items (itens de licitação) within procurements.
- **Key**: `(procurement_id, item_number)` compound
- **Notable columns**: `description`, `kind` (material|service), `quantity`, `unit`, `estimated_unit_price`, `estimated_total`, `judging_criterion_id`, `results_requested_at` (demand queue for winners), `results_synced_at`
- **Notable indexes**: description FTS, results_queue (requested but not synced)
- **Purpose**: Itemization; used to populate the chat's "items_total" card and for results sync demand queue.

### `procurement_documents`
Edital, anexos, and related documents.
- **Key**: `(procurement_id, sequence)` compound
- **Notable columns**: `title`, `type_id`, `url`, `is_active`, `published_at`
- **Notable indexes**: PK only
- **Purpose**: Links to PDFs; text extraction happens in `procurement_document_texts`.

### `procurement_document_texts`
Deterministic PDF extraction results (once per document).
- **Key**: `(procurement_id, sequence)` compound, FK to `procurement_documents`
- **Notable columns**: `method` (pypdf|insufficient|not_pdf|failed), `pages`, `chars`, `text` (extracted body, if successful), `extracted_at`
- **Notable indexes**: PK only
- **Purpose**: Store extraction once; enrich reuses. Prevents LLM from analyzing the same scanned PDF repeatedly.

### `procurement_results`
Homologated winners (supplier, price) per item.
- **Key**: `(procurement_id, item_number, sequence)` compound, FK to `procurement_items`
- **Notable columns**: `supplier_tax_id`, `supplier_name`, `awarded_quantity`, `awarded_unit_price`, `awarded_total`, `discount_pct`, `price_registry_rank`, `result_date`
- **Notable indexes**: `supplier_tax_id`, `result_date`
- **Purpose**: Competitive intelligence (who wins, at what price). Populated by `lixto results sync` on-demand.

## Enrichment (Global, Once Per Procurement)

### `procurement_enrichments`
Canonical enrichment output (one row per open procurement). Written by `lixto enrich run`.
- **Key**: `procurement_id` (BIGINT) PK, FK to `procurements`
- **Notable columns**: `schema_version`, `model`, `confidence`, `status` (done|error), `summary`, `concepts[]`, `keywords[]`, `risks[]`, `categories[]`, `complexity`, `requires_certification`, `requires_technical_certificate`, `me_epp_exclusive`, `me_epp_preference`, `delivery_location`, `delivery_deadline_days`, `data` (JSONB full payload)
- **Notable indexes**: `status`
- **Purpose**: Faceted data for matching and enrichment facet population. Parsed once globally, reused by every company.

### `procurement_categories`
Normalized procurement categories (derived from enrichment).
- **Key**: `(procurement_id, category)` compound
- **Notable columns**: `category` (text, e.g., 'material_escritorio')
- **Notable indexes**: `category` GIN
- **Purpose**: "All procurements in the 'infrastructure' category".

### `procurement_requirements`
Participation requirements (certifications, documents, qualifications).
- **Key**: `(procurement_id, sequence)` compound
- **Notable columns**: `kind` (legal_qualification|tax_compliance|technical_qualification|economic_qualification|document|certification|sample|site_visit|other), `description`
- **Notable indexes**: `kind`
- **Purpose**: Qualification filtering (company has/lacks required certs).

### `procurement_cnaes`
Industry classifications for procurements (from enrichment).
- **Key**: `(procurement_id, cnae_code)` compound
- **Notable columns**: `cnae_code` (CHAR(7)), `confidence` (REAL), `origin` (enrichment only)
- **Notable indexes**: `cnae_code`
- **Purpose**: CNAE-based matching (company CNAEs vs procurement CNAEs). Not FK-enforced; enrichment may emit unknown codes.

### `procurement_embeddings`
pgvector embeddings for semantic search.
- **Key**: `procurement_id` (BIGINT) PK, FK to `procurements`
- **Notable columns**: `model`, `embedding` (vector(1536)), `embedded_at`
- **Notable indexes**: HNSW cosine index on `embedding`
- **Purpose**: Semantic matching (company profile vector vs procurement vector).

## Annual Procurement Plans (PCA)

### `procurement_plans`
Planos de Contratação Anual — forward signal of what agencies will buy.
- **Key**: `id` (BIGSERIAL surrogate)
- **Natural key**: `(source, source_id)` UNIQUE
- **Notable columns**: `agency_tax_id`, `year`, `published_at`, `source_global_updated_at` (watermark), `item_count`
- **Notable indexes**: `(agency_tax_id, year)`
- **Purpose**: Proactive opportunity discovery (supplier can see planned procurements before tenders are published). Source: `/v1/pca/atualizacao`.

### `procurement_plan_items`
Items within a plan (e.g., "desks — 100 units, value R$ 5000").
- **Key**: `(plan_id, item_number)` compound, FK to `procurement_plans`
- **Notable columns**: `description`, `catalog_classification_id`, `supply_unit`, `estimated_quantity`, `unit_value`, `total_value`, `desired_date`
- **Notable indexes**: `desired_date`, description FTS
- **Purpose**: Itemized plans (used by proactive matching and supplier forecasting).

## Contracts

### `contracts`
Historical contracts (post-procurement winners and amendments).
- **Key**: `id` (BIGSERIAL surrogate)
- **Natural key**: `(source, source_id)` UNIQUE
- **Notable columns**: `agency_tax_id`, `procurement_id` (FK, may be NULL if procurement not synced), `supplier_tax_id`, `contract_number`, `description`, `initial_value`, `global_value`, `accumulated_value`, `signed_at`, `starts_at`, `ends_at`, `published_at`, `source_global_updated_at` (watermark), `amendments_synced_at`
- **Notable indexes**: `supplier_tax_id`, `agency_tax_id`, `signed_at`, `ends_at`, `procurement_id`, `procurement_source_id`, amendments_pending (amendments_synced_at IS NULL)
- **Purpose**: Supplier track record and competitive intelligence (contract values, dates, performance history). Source: `/v1/contratos/atualizacao`.

### `contract_amendments`
Modifications to contracts (additions, readjustments, extensions, replacements).
- **Key**: `(contract_id, sequence)` compound, FK to `contracts`
- **Notable columns**: `number`, `type_name`, `description`, `value_added`, `extended_days`, `supplier_tax_id`, `signed_at`, `starts_at`, `ends_at`, `published_at`, `qualifiers` (JSONB)
- **Notable indexes**: PK only
- **Purpose**: Contract evolution tracking. Source: `/v1/orgaos/{cnpj}/contratos/{ano}/{seq}/termos`.

## Companies (Customers)

### `companies`
Supplier/buyer companies (multi-tenant).
- **Key**: `id` (BIGSERIAL surrogate)
- **Natural key**: `tax_id` (CHAR(14), CNPJ digits only) UNIQUE
- **Notable columns**: `legal_name`, `trade_name`, `size` (MEI|ME|EPP|MEDIUM|LARGE), `simples_optant`, `state`, `city_name`, `email`, `phone`
- **Notable indexes**: PK only
- **Purpose**: Company profiles (one per tenant). Signed up via `/signup`.

### `company_cnaes`
Company's primary and secondary industry classifications.
- **Key**: `id` (BIGSERIAL) PK
- **Notable columns**: `company_id` (FK), `cnae_code` (CHAR(7)), `description`, `is_primary` (boolean)
- **Notable indexes**: `(company_id, cnae_code)` UNIQUE, `company_id` with is_primary filter
- **Purpose**: Industry matching (company CNAE × procurement CNAE).

### `company_profiles`
Per-company match profile (products, keywords, preferences).
- **Key**: `company_id` (BIGINT) PK, FK to `companies`
- **Notable columns**: `products[]`, `keywords[]`, `exclusions[]`, `terms[]` (normalized products+keywords), `exclusion_terms[]`, `states[]` (empty = all UF), `min_value`, `max_value`, `embedding` (vector 1536 from terms), `embedding_text`, `embedding_model`
- **Notable indexes**: `terms` GIN, no other (small table)
- **Purpose**: Company's match criteria. Filled via `/company/profile` form. Used by match-engine on every search.

### `company_documents`
Habilitação uploads (certs, tax clearances, etc.).
- **Key**: `id` (BIGSERIAL)
- **Notable columns**: `company_id` (FK), `kind` (articles_of_association|cnpj_card|federal_tax_clearance|fgts_clearance|...), `file_name`, `storage_path` (relative to UPLOADS_DIR), `mime_type`, `size_bytes`, `valid_until`, `uploaded_by` (FK to `users`)
- **Notable indexes**: `company_id`
- **Purpose**: Qualification documents; match engine checks `requires_certification` against uploaded docs.

## Users & Auth

### `users`
Team members (per company).
- **Key**: `id` (BIGSERIAL)
- **Notable columns**: `company_id` (FK), `email` (lowercased, UNIQUE), `password_hash`, `name`, `cpf`, `job_title`, `role` (admin|member), `invite_token_hash`, `invite_expires_at`
- **Notable indexes**: `(company_id)`, `(email)`
- **Purpose**: Multi-user, role-based access. Invited via `/invite/[token]`.

### `sessions`
Active login sessions.
- **Key**: `token_hash` (TEXT, sha256 hex) PK
- **Notable columns**: `user_id` (FK), `expires_at`
- **Notable indexes**: `user_id`
- **Purpose**: Stateless auth (token in `lixto_session` cookie).

## Agent Core (Cycle 18+)

### `agent_runs`
Every CLI run, sync, enrichment, or chat turn.
- **Key**: `id` (BIGSERIAL)
- **Notable columns**: `kind` (sync.procurements|sync.details|sync.results|sync.plans|sync.contracts|enrich|embed|chat|match|...), `company_id` (FK, NULL for CLI ops), `status` (running|done|failed), `started_at`, `finished_at`, `counters` (JSONB: {inserted, updated, failed, etc.}), `error`
- **Notable indexes**: `(kind, started_at DESC)`
- **Purpose**: Audit trail and status tracking.

### `conversations`
Chat threads.
- **Key**: `id` (BIGSERIAL)
- **Notable columns**: `company_id` (FK), `user_id` (FK), `title` (optional, auto-set from first message), `created_at`, `updated_at`
- **Notable indexes**: `(user_id, updated_at DESC)`
- **Purpose**: Conversation history per user (one user, one company).

### `messages`
Messages within a conversation.
- **Key**: `id` (BIGSERIAL)
- **Notable columns**: `conversation_id` (FK), `role` (user|assistant|tool), `content` (text), `tool_calls` (JSONB array of {name, id, arguments}), `tool_call_id` (string, links back to tool_calls), `refs` (JSONB ProcurementRef[] rendered as cards), `model` (e.g. gpt-4o-mini), `created_at`
- **Notable indexes**: `(conversation_id, id)`
- **Purpose**: Chat transcript. Refs (procurement cards shown in UI) are denormalized here for display.

### `opportunities`, `matches`, `recommendations`, `agent_actions`, `opportunity_feedback`
Placeholder tables (exist in schema, not written in cycle 18; written by cycle 19+ — see `docs/ARCHITECTURE.md` Agent Core):

### `matches`
Persisted score history per company × procurement. Key `id`; index `(company_id, procurement_id, computed_at DESC)`. Columns: `score`, `reasons JSONB [{code, weight, detail}]`, `engine_version`, `computed_at`.

### `recommendations`
GO / NO-GO artifacts per opportunity. Key `id`; index `(opportunity_id, created_at DESC)`. `verdict` ∈ `go|no_go|borderline`, `rationale`, `model`, `confidence`.

### `agent_actions`
Prepare/execute actions with human approval. Key `id`; index `(opportunity_id)`. `kind`, `payload JSONB`, `requires_approval`, `status` ∈ `proposed|approved|rejected|executed|failed`, `approved_by`, `approved_at`, `executed_at`, `result`, `error`.

### `opportunity_feedback`
Learning loop. Key `id`; index `(opportunity_id)`. `kind` ∈ `accepted|rejected|participated|won|lost|disqualified`, `reason`, `price`, `margin_pct`.

## Legacy → New Naming Map

| Legacy | New |
|---|---|
| `licitacao` | `procurements` (+ `agencies`, `agency_units`) |
| `item` | `procurement_items` |
| `documento` / `documento_texto` | `procurement_documents` / `procurement_document_texts` |
| `resultado` | `procurement_results` |
| `enriquecimento` | `procurement_enrichments` + `procurement_categories` + `procurement_requirements` + `procurement_cnaes` + `procurement_embeddings` |
| `cnae` | `cnae_codes` |
| `sync_state` | `sync_state` |
| `empresa` / `empresa_cnae` / `empresa_perfil` / `documento_empresa` | `companies` / `company_cnaes` / `company_profiles` / `company_documents` |
| `usuario` / `sessao` | `users` / `sessions` |
| `conversa` / `mensagem` | `conversations` / `messages` |
| — | `sources`, `source_payloads`, `procurement_plans`, `procurement_plan_items`, `contracts`, `contract_amendments`, `opportunities`, `matches`, `recommendations`, `agent_runs`, `agent_actions`, `opportunity_feedback` |

**Dropped**: `licitacao_cnae`, `setor`, `analise` (legacy triage/deep agents), `company_profile.md` (file storage).

## Query Examples

### Find open procurements by state and modality
```sql
SELECT id, source_id, description, estimated_value, proposal_closes_at
FROM procurements
WHERE state = 'SP' AND modality_id = 1 AND status_id = 1
ORDER BY proposal_closes_at DESC
LIMIT 20;
```

### All procurements a company might match (basic)
```sql
SELECT p.id, p.source_id, p.description, c.cnae_code
FROM procurements p
LEFT JOIN procurement_cnaes c ON p.id = c.procurement_id
WHERE p.state IN (SELECT unnest(states) FROM company_profiles WHERE company_id = $1)
  AND (c.cnae_code IN (SELECT cnae_code FROM company_cnaes WHERE company_id = $1) OR c.cnae_code IS NULL)
  AND p.estimated_value BETWEEN
    (SELECT min_value FROM company_profiles WHERE company_id = $1)
    AND (SELECT max_value FROM company_profiles WHERE company_id = $1)
LIMIT 50;
```

### Supplier's recent contract history
```sql
SELECT id, contract_number, description, signed_at, global_value
FROM contracts
WHERE supplier_tax_id = $1
ORDER BY signed_at DESC
LIMIT 20;
```

### Upcoming procurements (PCA items by desired date)
```sql
SELECT ppi.item_number, ppi.description, ppi.estimated_quantity, ppi.unit_value, ppi.desired_date
FROM procurement_plan_items ppi
JOIN procurement_plans pp ON ppi.plan_id = pp.id
WHERE pp.agency_tax_id = $1 AND ppi.desired_date > NOW()
ORDER BY ppi.desired_date ASC;
```
