# ADR 001 — Lixto core data model (built from zero, English)

- Status: accepted (cycle 18, 2026-08-25)
- Deciders: Alex Azevedo (product), forge plan
- Supersedes: the `plataforma-licitante` schema (migrations 001–013 of the legacy repo, Portuguese identifiers)

## Context

Lixto pivoted from a procurement *platform* to a procurement *agent*. The legacy schema was PNCP-shaped, Portuguese, carried two redundant classification pipelines (Ollama setor / two-stage CNAE next to LLM enrichment), a legacy triage/deep `analise` table next to the match engine, and had no agent-core entities. `docs/VISION.md` §7 lists the entities the product actually needs. Nothing is migrated: the new database starts empty and is filled by a new PNCP sync (PRODUCT.md, cycle 18).

## Decision

### D1. One new database, English, plural table names

- Database `lixto` on the shared Postgres (`pg-shared`, pgvector available), owner role `lixto`, default schema `public`. Local dev: `docker-compose` service `db` with database/user/password `lixto`, port 5433, volume `lixto_pgdata`.
- Identifiers: `snake_case`, English, **plural** table names as in the vision (`procurements`, `companies`, `matches`). Brazilian legal/domain terms that have no faithful English stay as terms: `cnae`, `me_epp_*`, `modality`, `price_registry` (SRP/ata), `tax_id` (CNPJ/CPF), `state` (UF).
- Every table has `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`; mutable tables also `updated_at`. Money is `NUMERIC(18,2)`; quantities `NUMERIC(18,4)`; percentages `NUMERIC(7,4)`. Enumerations are `TEXT` + `CHECK` (no PG enums — cheaper to evolve).
- Surrogate `id BIGSERIAL` on ingested entities (`procurements`, `procurement_plans`, `contracts`) with a `UNIQUE (source, source_id)` natural key; child tables key on the parent `id`.

### D2. Source abstraction and raw retention

- `sources` reference table; every ingested entity carries `source TEXT NOT NULL REFERENCES sources` and `source_id TEXT`. Today one row: `pncp`.
- Raw payloads are **not** columns on hot tables. `source_payloads (source, entity_type, external_id) → payload JSONB` keeps the complete DTO (or the complete array for list endpoints) per fetch, so any entity can be reprocessed and hot rows stay lean. `entity_type` ∈ `procurement`, `procurement_items`, `procurement_documents`, `procurement_results`, `procurement_plan`, `contract`, `contract_amendments`.

### D3. World model (public procurement facts) — vision §5, §7

Buyers: `agencies` (orgaoEntidade) + `agency_units` (unidadeOrgao). `procurements` denormalizes `state`/`city_name` from the unit because they are the hottest filters.

Procurement facets that are queried across procurements get their own table (vision names): `procurement_categories`, `procurement_requirements`, `procurement_cnaes`, `procurement_embeddings`. Short arrays used only for `&&` matching (`keywords`, `concepts`, `risks`) stay on `procurement_enrichments`.

New domains: `procurement_plans` + `procurement_plan_items` (PCA — `/v1/pca/atualizacao` returns plans with items embedded), `contracts` + `contract_amendments` (`/v1/contratos`, `/v1/contratos/atualizacao`, `/v1/orgaos/{cnpj}/contratos/{ano}/{seq}/termos`).

Dropped on purpose: Ollama `setor`, two-stage CNAE tags, `analise` (triage/deep), `company_profile.md`. CNAE per procurement now comes from enrichment (`procurement_cnaes.origin = 'enrichment'`).

### D4. Companies (customers) — vision §8

`companies`, `company_cnaes`, `company_profiles` (products/keywords/exclusions/states/value range + embedding — the vision's `organization_products/capabilities/preferences` folded into one row per company; split later only if a facet needs cross-company queries), `company_documents`, `users`, `sessions`.

### D5. Agent core — vision §11–§14

`opportunities` (per company × procurement lifecycle), `matches` (persisted score history), `recommendations` (GO/NO-GO artifacts), `agent_runs` (every CLI/batch/chat run), `agent_actions` (prepare/execute with approval fields), `opportunity_feedback` (learning loop), `conversations`, `messages`. In cycle 18 only `agent_runs`, `conversations`, `messages` are written; the others exist so later cycles add behaviour, not schema.

### D6. Naming map (legacy → new)

| legacy | new |
|---|---|
| `licitacao` | `procurements` (+ `agencies`, `agency_units`) |
| `item` | `procurement_items` |
| `documento` / `documento_texto` | `procurement_documents` / `procurement_document_texts` |
| `resultado` | `procurement_results` |
| `enriquecimento` | `procurement_enrichments` + `procurement_categories` + `procurement_requirements` + `procurement_cnaes` + `procurement_embeddings` |
| `licitacao_cnae`, `licitacao.setor`, `analise` | dropped |
| `cnae` | `cnae_codes` |
| `sync_state` | `sync_state` |
| `empresa` / `empresa_cnae` / `empresa_perfil` / `documento_empresa` | `companies` / `company_cnaes` / `company_profiles` / `company_documents` |
| `usuario` / `sessao` | `users` / `sessions` |
| `conversa` / `mensagem` | `conversations` / `messages` |
| — | `sources`, `source_payloads`, `procurement_plans`, `procurement_plan_items`, `contracts`, `contract_amendments`, `opportunities`, `matches`, `recommendations`, `agent_runs`, `agent_actions`, `opportunity_feedback` |

Column-level map for the PNCP DTOs is in the DDL comments below and in `docs/PNCP_API.md`.

### D7. Code and configuration names

Python package `lixto` (`src/lixto`), CLI `lixto`, env prefix `LIXTO_` (`LIXTO_DATABASE_URL`, `LIXTO_LLM_BASE_URL`, `LIXTO_LLM_API_KEY`, `LIXTO_LLM_MODEL_CHEAP|DOC|STRONG|FALLBACK|EMBED`, `LIXTO_CHAT_MODEL`), session cookie `lixto_session`, web routes in English (`/procurements`, `/procurement/[sourceId]`, `/company`, `/company/profile`, `/company/users`, `/company/documents`, `/lixto`, `/login`, `/signup`, `/invite/[token]`). UI copy stays Portuguese.

## DDL — `migrations/001_core.sql`

Ticket 74 ships this file verbatim (plus the header comment). Later tickets never alter these tables in cycle 18; if a column is missing, the ticket is wrong, not the schema.

```sql
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS vector;

-- unaccent() is STABLE; FTS expression indexes need an IMMUTABLE wrapper.
CREATE OR REPLACE FUNCTION f_unaccent(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  RETURN unaccent('unaccent', $1);

-- ---------------------------------------------------------------- reference
CREATE TABLE sources (
    id          TEXT PRIMARY KEY,           -- 'pncp'
    name        TEXT NOT NULL,
    base_url    TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO sources (id, name, base_url) VALUES ('pncp', 'Portal Nacional de Contratações Públicas', 'https://pncp.gov.br');

CREATE TABLE cnae_codes (                   -- IBGE subclasses, seeded by `lixto cnae seed`
    code                 CHAR(7) PRIMARY KEY,
    description          TEXT NOT NULL,
    division             CHAR(2) NOT NULL,
    division_description TEXT NOT NULL
);

CREATE TABLE sync_state (
    key         TEXT PRIMARY KEY,           -- e.g. 'incremental:procurements:6', 'incremental:plans', 'incremental:contracts'
    value       JSONB,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE source_payloads (
    source       TEXT NOT NULL REFERENCES sources (id),
    entity_type  TEXT NOT NULL CHECK (entity_type IN ('procurement','procurement_items','procurement_documents','procurement_results','procurement_plan','contract','contract_amendments')),
    external_id  TEXT NOT NULL,             -- procurement/plan/contract source_id; for results: '<source_id>#<item_number>'
    payload      JSONB NOT NULL,
    fetched_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (source, entity_type, external_id)
);

-- ---------------------------------------------------------------- buyers
CREATE TABLE agencies (                     -- orgaoEntidade
    tax_id      CHAR(14) PRIMARY KEY,       -- cnpj, digits only
    name        TEXT NOT NULL,              -- razaoSocial
    power_code  TEXT,                       -- poderId
    sphere_code TEXT,                       -- esferaId
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE agency_units (                 -- unidadeOrgao
    agency_tax_id CHAR(14) NOT NULL REFERENCES agencies (tax_id),
    code          TEXT NOT NULL,            -- codigoUnidade
    name          TEXT,                     -- nomeUnidade
    state         CHAR(2),                  -- ufSigla
    city_name     TEXT,                     -- municipioNome
    ibge_code     TEXT,                     -- codigoIbge
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (agency_tax_id, code)
);

-- ---------------------------------------------------------------- procurements
CREATE TABLE procurements (                 -- RecuperarCompraPublicacaoDTO
    id                        BIGSERIAL PRIMARY KEY,
    source                    TEXT NOT NULL REFERENCES sources (id),
    source_id                 TEXT NOT NULL,            -- numeroControlePNCP
    agency_tax_id             CHAR(14) NOT NULL REFERENCES agencies (tax_id),
    unit_code                 TEXT,                     -- unidadeOrgao.codigoUnidade
    state                     CHAR(2),                  -- unidadeOrgao.ufSigla (denormalized: hot filter)
    city_name                 TEXT,                     -- unidadeOrgao.municipioNome
    year                      INTEGER,                  -- anoCompra
    sequence                  INTEGER,                  -- sequencialCompra
    number                    TEXT,                     -- numeroCompra
    process_number            TEXT,                     -- processo
    modality_id               INTEGER,                  -- modalidadeId
    modality_name             TEXT,
    dispute_mode_id           INTEGER,                  -- modoDisputaId
    dispute_mode_name         TEXT,
    status_id                 INTEGER,                  -- situacaoCompraId
    status_name               TEXT,
    instrument_type_id        INTEGER,                  -- tipoInstrumentoConvocatorioCodigo
    instrument_type_name      TEXT,
    legal_basis_code          TEXT,                     -- amparoLegal.codigo
    legal_basis_name          TEXT,
    description               TEXT,                     -- objetoCompra
    additional_info           TEXT,                     -- informacaoComplementar
    is_price_registry         BOOLEAN,                  -- srp
    estimated_value           NUMERIC(18,2),            -- valorTotalEstimado
    awarded_value             NUMERIC(18,2),            -- valorTotalHomologado
    proposal_opens_at         TIMESTAMPTZ,              -- dataAberturaProposta
    proposal_closes_at        TIMESTAMPTZ,              -- dataEncerramentoProposta
    published_at              TIMESTAMPTZ,              -- dataPublicacaoPncp
    source_created_at         TIMESTAMPTZ,              -- dataInclusao
    source_updated_at         TIMESTAMPTZ,              -- dataAtualizacao
    source_global_updated_at  TIMESTAMPTZ,              -- dataAtualizacaoGlobal (incremental key)
    origin_system             TEXT,                     -- usuarioNome (portal that published)
    origin_url                TEXT,                     -- linkSistemaOrigem (where proposals are submitted)
    process_url               TEXT,                     -- linkProcessoEletronico
    budget_sources            JSONB,                    -- fontesOrcamentarias
    items_synced_at           TIMESTAMPTZ,
    documents_synced_at       TIMESTAMPTZ,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (source, source_id)
);
CREATE INDEX idx_procurements_state ON procurements (state);
CREATE INDEX idx_procurements_modality ON procurements (modality_id);
CREATE INDEX idx_procurements_published_at ON procurements (published_at);
CREATE INDEX idx_procurements_proposal_closes_at ON procurements (proposal_closes_at);
CREATE INDEX idx_procurements_proposal_opens_at ON procurements (proposal_opens_at);
CREATE INDEX idx_procurements_agency ON procurements (agency_tax_id);
CREATE INDEX idx_procurements_origin_system ON procurements (origin_system);
CREATE INDEX idx_procurements_global_updated ON procurements (source_global_updated_at);
CREATE INDEX idx_procurements_details_pending ON procurements (id) WHERE items_synced_at IS NULL OR documents_synced_at IS NULL;
CREATE INDEX idx_procurements_description_fts ON procurements USING gin (to_tsvector('portuguese', f_unaccent(coalesce(description, ''))));

CREATE TABLE procurement_items (            -- RecuperarCompraItemSigiloDTO
    procurement_id        BIGINT NOT NULL REFERENCES procurements (id) ON DELETE CASCADE,
    item_number           INTEGER NOT NULL,             -- numeroItem
    description           TEXT,
    kind                  TEXT CHECK (kind IN ('material','service')), -- materialOuServico M/S
    quantity              NUMERIC(18,4),                -- quantidade
    unit                  TEXT,                         -- unidadeMedida
    estimated_unit_price  NUMERIC(18,4),                -- valorUnitarioEstimado
    estimated_total       NUMERIC(18,2),                -- valorTotal
    judging_criterion_id  INTEGER,                      -- criterioJulgamentoId
    judging_criterion_name TEXT,
    status_id             INTEGER,                      -- situacaoCompraItem
    status_name           TEXT,
    benefit_type_id       INTEGER,                      -- tipoBeneficio
    benefit_type_name     TEXT,
    ncm_nbs_code          TEXT,
    catalog_code          TEXT,                         -- catalogoCodigoItem
    source_created_at     TIMESTAMPTZ,
    source_updated_at     TIMESTAMPTZ,
    results_requested_at  TIMESTAMPTZ,                  -- demand queue (price benchmark)
    results_synced_at     TIMESTAMPTZ,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (procurement_id, item_number)
);
CREATE INDEX idx_procurement_items_description_fts ON procurement_items USING gin (to_tsvector('portuguese', f_unaccent(coalesce(description, ''))));
CREATE INDEX idx_procurement_items_results_queue ON procurement_items (results_requested_at) WHERE results_requested_at IS NOT NULL AND results_synced_at IS NULL;

CREATE TABLE procurement_documents (        -- RecuperarDadosDocumentoCompraDTO
    procurement_id    BIGINT NOT NULL REFERENCES procurements (id) ON DELETE CASCADE,
    sequence          INTEGER NOT NULL,                 -- sequencialDocumento
    title             TEXT,
    type_id           INTEGER,                          -- tipoDocumentoId (2 = edital)
    type_name         TEXT,
    type_description  TEXT,
    url               TEXT,
    is_active         BOOLEAN,                          -- statusAtivo
    published_at      TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (procurement_id, sequence)
);

CREATE TABLE procurement_document_texts (   -- deterministic PDF extraction, stored once
    procurement_id  BIGINT NOT NULL,
    sequence        INTEGER NOT NULL,
    method          TEXT NOT NULL CHECK (method IN ('pypdf','insufficient','not_pdf','failed')),
    pages           INTEGER,
    chars           INTEGER NOT NULL DEFAULT 0,
    text            TEXT,
    extracted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (procurement_id, sequence),
    FOREIGN KEY (procurement_id, sequence) REFERENCES procurement_documents (procurement_id, sequence) ON DELETE CASCADE
);

CREATE TABLE procurement_results (          -- RecuperarCompraItemResultadoDTO
    procurement_id        BIGINT NOT NULL,
    item_number           INTEGER NOT NULL,
    sequence              INTEGER NOT NULL,             -- sequencialResultado
    supplier_tax_id       TEXT,                         -- niFornecedor
    supplier_name         TEXT,                         -- nomeRazaoSocialFornecedor
    supplier_kind         TEXT,                         -- tipoPessoa (PJ/PF/PE)
    supplier_size_id      INTEGER,                      -- porteFornecedorId
    supplier_size_name    TEXT,
    awarded_quantity      NUMERIC(18,4),                -- quantidadeHomologada
    awarded_unit_price    NUMERIC(18,4),                -- valorUnitarioHomologado
    awarded_total         NUMERIC(18,2),                -- valorTotalHomologado
    discount_pct          NUMERIC(7,4),                 -- percentualDesconto
    price_registry_rank   INTEGER,                      -- ordemClassificacaoSrp (NULL or 1 = winner)
    status_id             INTEGER,                      -- situacaoCompraItemResultadoId
    status_name           TEXT,
    has_subcontracting    BOOLEAN,                      -- indicadorSubcontratacao
    result_date           DATE,                         -- dataResultado
    cancelled_at          TIMESTAMPTZ,                  -- dataCancelamento
    cancel_reason         TEXT,                         -- motivoCancelamento
    source_created_at     TIMESTAMPTZ,
    source_updated_at     TIMESTAMPTZ,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (procurement_id, item_number, sequence),
    FOREIGN KEY (procurement_id, item_number) REFERENCES procurement_items (procurement_id, item_number) ON DELETE CASCADE
);
CREATE INDEX idx_procurement_results_supplier ON procurement_results (supplier_tax_id);
CREATE INDEX idx_procurement_results_date ON procurement_results (result_date);

-- ---------------------------------------------------------------- enrichment (global, once per procurement)
CREATE TABLE procurement_enrichments (
    procurement_id                 BIGINT PRIMARY KEY REFERENCES procurements (id) ON DELETE CASCADE,
    schema_version                 TEXT NOT NULL,
    model                          TEXT,
    confidence                     REAL,
    status                         TEXT NOT NULL CHECK (status IN ('done','error')),
    error                          TEXT,
    input_kind                     TEXT NOT NULL CHECK (input_kind IN ('structured','text','pdf')),
    summary                        TEXT,
    concepts                       TEXT[] NOT NULL DEFAULT '{}',   -- normalized
    keywords                       TEXT[] NOT NULL DEFAULT '{}',   -- normalized
    risks                          TEXT[] NOT NULL DEFAULT '{}',
    complexity                     TEXT CHECK (complexity IN ('low','medium','high')),
    requires_certification         BOOLEAN,
    requires_technical_certificate BOOLEAN,
    me_epp_exclusive               BOOLEAN,
    me_epp_preference              BOOLEAN,
    delivery_location              TEXT,
    delivery_deadline_days         INTEGER,
    data                           JSONB NOT NULL,                 -- full canonical payload
    enriched_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at                     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_procurement_enrichments_keywords ON procurement_enrichments USING gin (keywords);
CREATE INDEX idx_procurement_enrichments_concepts ON procurement_enrichments USING gin (concepts);
CREATE INDEX idx_procurement_enrichments_status ON procurement_enrichments (status);

CREATE TABLE procurement_categories (
    procurement_id  BIGINT NOT NULL REFERENCES procurements (id) ON DELETE CASCADE,
    category        TEXT NOT NULL,                      -- normalized
    PRIMARY KEY (procurement_id, category)
);
CREATE INDEX idx_procurement_categories_category ON procurement_categories (category);

CREATE TABLE procurement_requirements (
    procurement_id  BIGINT NOT NULL REFERENCES procurements (id) ON DELETE CASCADE,
    sequence        INTEGER NOT NULL,
    kind            TEXT NOT NULL CHECK (kind IN ('legal_qualification','tax_compliance','technical_qualification','economic_qualification','document','certification','sample','site_visit','other')),
    description     TEXT NOT NULL,
    PRIMARY KEY (procurement_id, sequence)
);
CREATE INDEX idx_procurement_requirements_kind ON procurement_requirements (kind);

CREATE TABLE procurement_cnaes (
    procurement_id  BIGINT NOT NULL REFERENCES procurements (id) ON DELETE CASCADE,
    cnae_code       CHAR(7) NOT NULL,                   -- digits only; not FK-enforced (enrichment may emit codes absent from the seed)
    confidence      REAL,
    origin          TEXT NOT NULL DEFAULT 'enrichment' CHECK (origin IN ('enrichment')),
    PRIMARY KEY (procurement_id, cnae_code)
);
CREATE INDEX idx_procurement_cnaes_code ON procurement_cnaes (cnae_code);

CREATE TABLE procurement_embeddings (
    procurement_id  BIGINT PRIMARY KEY REFERENCES procurements (id) ON DELETE CASCADE,
    model           TEXT NOT NULL,
    embedding       vector(1536) NOT NULL,
    embedded_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_procurement_embeddings_hnsw ON procurement_embeddings USING hnsw (embedding vector_cosine_ops);

-- ---------------------------------------------------------------- annual procurement plans (PCA)
CREATE TABLE procurement_plans (            -- PlanoContratacaoComItensDoUsuarioDTO
    id                        BIGSERIAL PRIMARY KEY,
    source                    TEXT NOT NULL REFERENCES sources (id),
    source_id                 TEXT NOT NULL,            -- idPcaPncp
    agency_tax_id             CHAR(14) NOT NULL REFERENCES agencies (tax_id),
    unit_code                 TEXT,                     -- codigoUnidade
    unit_name                 TEXT,                     -- nomeUnidade
    year                      INTEGER NOT NULL,         -- anoPca
    published_at              TIMESTAMPTZ,              -- dataPublicacaoPNCP
    source_global_updated_at  TIMESTAMPTZ,              -- dataAtualizacaoGlobalPCA
    item_count                INTEGER NOT NULL DEFAULT 0,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (source, source_id)
);
CREATE INDEX idx_procurement_plans_agency_year ON procurement_plans (agency_tax_id, year);

CREATE TABLE procurement_plan_items (       -- PlanoContratacaoItemDTO
    plan_id                    BIGINT NOT NULL REFERENCES procurement_plans (id) ON DELETE CASCADE,
    item_number                INTEGER NOT NULL,        -- numeroItem
    category_name              TEXT,                    -- categoriaItemPcaNome
    catalog_classification_id  INTEGER,                 -- classificacaoCatalogoId
    catalog_classification_name TEXT,                   -- nomeClassificacaoCatalogo
    superior_classification_code TEXT,                  -- classificacaoSuperiorCodigo
    superior_classification_name TEXT,
    pdm_code                   TEXT,                    -- pdmCodigo
    pdm_description            TEXT,
    item_code                  TEXT,                    -- codigoItem
    description                TEXT,                    -- descricaoItem
    supply_unit                TEXT,                    -- unidadeFornecimento
    estimated_quantity         NUMERIC(18,4),           -- quantidadeEstimada
    unit_value                 NUMERIC(18,4),           -- valorUnitario
    total_value                NUMERIC(18,2),           -- valorTotal
    budget_year_value          NUMERIC(18,2),           -- valorOrcamentoExercicio
    requesting_unit            TEXT,                    -- unidadeRequisitante
    desired_date               DATE,                    -- dataDesejada
    contracting_group_code     TEXT,                    -- grupoContratacaoCodigo
    contracting_group_name     TEXT,
    source_created_at          TIMESTAMPTZ,
    source_updated_at          TIMESTAMPTZ,
    created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (plan_id, item_number)
);
CREATE INDEX idx_procurement_plan_items_desired_date ON procurement_plan_items (desired_date);
CREATE INDEX idx_procurement_plan_items_description_fts ON procurement_plan_items USING gin (to_tsvector('portuguese', f_unaccent(coalesce(description, ''))));

-- ---------------------------------------------------------------- contracts
CREATE TABLE contracts (                    -- RecuperarContratoDTO
    id                        BIGSERIAL PRIMARY KEY,
    source                    TEXT NOT NULL REFERENCES sources (id),
    source_id                 TEXT NOT NULL,            -- numeroControlePNCP (of the contract)
    procurement_source_id     TEXT,                     -- numeroControlePncpCompra (may reference a procurement we have not synced)
    procurement_id            BIGINT REFERENCES procurements (id) ON DELETE SET NULL,
    price_registry_source_id  TEXT,                     -- numeroControlePncpAta
    agency_tax_id             CHAR(14) NOT NULL REFERENCES agencies (tax_id),
    unit_code                 TEXT,
    year                      INTEGER,                  -- anoContrato
    sequence                  INTEGER,                  -- sequencialContrato
    contract_number           TEXT,                     -- numeroContratoEmpenho
    process_number            TEXT,                     -- processo
    type_id                   INTEGER,                  -- tipoContrato.id
    type_name                 TEXT,
    category_id               INTEGER,                  -- categoriaProcesso.id
    category_name             TEXT,
    supplier_tax_id           TEXT,                     -- niFornecedor
    supplier_name             TEXT,                     -- nomeRazaoSocialFornecedor
    supplier_kind             TEXT,                     -- tipoPessoa
    supplier_country_code     TEXT,                     -- codigoPaisFornecedor
    subcontractor_tax_id      TEXT,                     -- niFornecedorSubContratado
    subcontractor_name        TEXT,
    description               TEXT,                     -- objetoContrato
    additional_info           TEXT,                     -- informacaoComplementar
    is_revenue                BOOLEAN,                  -- receita
    installments              INTEGER,                  -- numeroParcelas
    installment_value         NUMERIC(18,2),            -- valorParcela
    initial_value             NUMERIC(18,2),            -- valorInicial
    global_value              NUMERIC(18,2),            -- valorGlobal
    accumulated_value         NUMERIC(18,2),            -- valorAcumulado
    signed_at                 DATE,                     -- dataAssinatura
    starts_at                 DATE,                     -- dataVigenciaInicio
    ends_at                   DATE,                     -- dataVigenciaFim
    published_at              TIMESTAMPTZ,              -- dataPublicacaoPncp
    source_updated_at         TIMESTAMPTZ,              -- dataAtualizacao
    source_global_updated_at  TIMESTAMPTZ,              -- dataAtualizacaoGlobal
    from_price_registry       BOOLEAN,                  -- frutoAdesao
    parliamentary_amendment   BOOLEAN,                  -- emendaParlamentar
    origin_system             TEXT,                     -- usuarioNome
    amendments_synced_at      TIMESTAMPTZ,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (source, source_id)
);
CREATE INDEX idx_contracts_supplier ON contracts (supplier_tax_id);
CREATE INDEX idx_contracts_agency ON contracts (agency_tax_id);
CREATE INDEX idx_contracts_signed_at ON contracts (signed_at);
CREATE INDEX idx_contracts_ends_at ON contracts (ends_at);
CREATE INDEX idx_contracts_procurement ON contracts (procurement_id);
CREATE INDEX idx_contracts_procurement_source_id ON contracts (procurement_source_id);
CREATE INDEX idx_contracts_amendments_pending ON contracts (id) WHERE amendments_synced_at IS NULL;
CREATE INDEX idx_contracts_description_fts ON contracts USING gin (to_tsvector('portuguese', f_unaccent(coalesce(description, ''))));

CREATE TABLE contract_amendments (          -- RecuperarTermoContratoDTO
    contract_id        BIGINT NOT NULL REFERENCES contracts (id) ON DELETE CASCADE,
    sequence           INTEGER NOT NULL,               -- sequencialTermoContrato
    number             TEXT,                           -- numeroTermoContrato
    type_name          TEXT,                           -- tipoTermoContratoNome
    description        TEXT,                           -- objetoTermoContrato
    legal_basis        TEXT,                           -- fundamentoLegal
    notes              TEXT,                           -- informativoObservacao
    qualifiers         JSONB,                          -- {added_or_removed, term, supplier, readjustment, informative} from qualificacao*
    value_added        NUMERIC(18,2),                  -- valorAcrescido
    installments       INTEGER,
    installment_value  NUMERIC(18,2),
    global_value       NUMERIC(18,2),
    extended_days      INTEGER,                        -- prazoAditadoDias
    supplier_tax_id    TEXT,
    supplier_name      TEXT,
    signed_at          DATE,
    starts_at          DATE,
    ends_at            DATE,
    published_at       TIMESTAMPTZ,
    source_created_at  TIMESTAMPTZ,
    source_updated_at  TIMESTAMPTZ,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (contract_id, sequence)
);

-- ---------------------------------------------------------------- companies (customers)
CREATE TABLE companies (
    id                     BIGSERIAL PRIMARY KEY,
    tax_id                 CHAR(14) NOT NULL UNIQUE,   -- cnpj, digits only
    legal_name             TEXT NOT NULL,              -- razao_social
    trade_name             TEXT,                       -- nome_fantasia
    legal_nature           TEXT,
    size                   TEXT CHECK (size IN ('MEI','ME','EPP','MEDIUM','LARGE')),
    simples_optant         BOOLEAN NOT NULL DEFAULT false,
    state_registration     TEXT,
    municipal_registration TEXT,
    postal_code            CHAR(8),
    street                 TEXT,
    street_number          TEXT,
    address_line2          TEXT,
    district               TEXT,
    city_name              TEXT,
    state                  CHAR(2),
    phone                  TEXT,
    email                  TEXT,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE company_cnaes (
    id          BIGSERIAL PRIMARY KEY,
    company_id  BIGINT NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
    cnae_code   CHAR(7) NOT NULL,
    description TEXT NOT NULL,
    is_primary  BOOLEAN NOT NULL DEFAULT false,
    UNIQUE (company_id, cnae_code)
);
CREATE UNIQUE INDEX idx_company_cnaes_primary ON company_cnaes (company_id) WHERE is_primary;

CREATE TABLE company_profiles (
    company_id        BIGINT PRIMARY KEY REFERENCES companies (id) ON DELETE CASCADE,
    products          TEXT[] NOT NULL DEFAULT '{}',     -- as typed
    keywords          TEXT[] NOT NULL DEFAULT '{}',     -- as typed
    exclusions        TEXT[] NOT NULL DEFAULT '{}',     -- as typed
    terms             TEXT[] NOT NULL DEFAULT '{}',     -- normalized(products ∪ keywords) — what the match engine reads
    exclusion_terms   TEXT[] NOT NULL DEFAULT '{}',     -- normalized(exclusions)
    states            CHAR(2)[] NOT NULL DEFAULT '{}',  -- empty = all
    min_value         NUMERIC(18,2),
    max_value         NUMERIC(18,2),
    notes             TEXT,
    embedding         vector(1536),
    embedding_text    TEXT,
    embedding_model   TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_company_profiles_terms ON company_profiles USING gin (terms);

CREATE TABLE users (
    id                 BIGSERIAL PRIMARY KEY,
    company_id         BIGINT NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
    email              TEXT NOT NULL UNIQUE,           -- lowercased
    password_hash      TEXT,                           -- NULL while invite pending
    name               TEXT NOT NULL,
    cpf                CHAR(11),
    phone              TEXT,
    job_title          TEXT,
    role               TEXT NOT NULL CHECK (role IN ('admin','member')),
    invite_token_hash  TEXT,
    invite_expires_at  TIMESTAMPTZ,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_users_company ON users (company_id);

CREATE TABLE sessions (
    token_hash  TEXT PRIMARY KEY,                       -- sha256 hex of the cookie token
    user_id     BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    expires_at  TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sessions_user ON sessions (user_id);

CREATE TABLE company_documents (            -- habilitação uploads
    id           BIGSERIAL PRIMARY KEY,
    company_id   BIGINT NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
    kind         TEXT NOT NULL CHECK (kind IN ('articles_of_association','cnpj_card','federal_tax_clearance','fgts_clearance','labor_clearance','state_tax_clearance','municipal_tax_clearance','balance_sheet','technical_capacity_certificate','other')),
    file_name    TEXT NOT NULL,
    storage_path TEXT NOT NULL,                         -- relative to UPLOADS_DIR
    mime_type    TEXT NOT NULL,
    size_bytes   BIGINT NOT NULL,
    valid_until  DATE,
    uploaded_by  BIGINT REFERENCES users (id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_company_documents_company ON company_documents (company_id);

-- ---------------------------------------------------------------- agent core
CREATE TABLE agent_runs (
    id           BIGSERIAL PRIMARY KEY,
    kind         TEXT NOT NULL,                         -- 'sync.procurements','sync.details','sync.results','sync.plans','sync.contracts','enrich','embed','chat','match', ...
    company_id   BIGINT REFERENCES companies (id) ON DELETE SET NULL,
    status       TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','done','failed')),
    started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at  TIMESTAMPTZ,
    counters     JSONB NOT NULL DEFAULT '{}',
    error        TEXT
);
CREATE INDEX idx_agent_runs_kind_started ON agent_runs (kind, started_at DESC);

CREATE TABLE opportunities (                -- per company × procurement lifecycle
    id              BIGSERIAL PRIMARY KEY,
    company_id      BIGINT NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
    procurement_id  BIGINT NOT NULL REFERENCES procurements (id) ON DELETE CASCADE,
    state           TEXT NOT NULL DEFAULT 'discovered' CHECK (state IN ('discovered','matched','analyzed','recommended','preparing','awaiting_approval','executed','dismissed')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (company_id, procurement_id)
);
CREATE INDEX idx_opportunities_company_state ON opportunities (company_id, state);

CREATE TABLE matches (                      -- persisted score history
    id              BIGSERIAL PRIMARY KEY,
    company_id      BIGINT NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
    procurement_id  BIGINT NOT NULL REFERENCES procurements (id) ON DELETE CASCADE,
    score           INTEGER NOT NULL,
    reasons         JSONB NOT NULL,                     -- [{code, weight, detail}]
    engine_version  TEXT NOT NULL,
    computed_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_matches_company_procurement ON matches (company_id, procurement_id, computed_at DESC);

CREATE TABLE recommendations (
    id              BIGSERIAL PRIMARY KEY,
    opportunity_id  BIGINT NOT NULL REFERENCES opportunities (id) ON DELETE CASCADE,
    verdict         TEXT NOT NULL CHECK (verdict IN ('go','no_go','borderline')),
    rationale       TEXT,
    model           TEXT,
    confidence      REAL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_recommendations_opportunity ON recommendations (opportunity_id, created_at DESC);

CREATE TABLE agent_actions (
    id                 BIGSERIAL PRIMARY KEY,
    run_id             BIGINT REFERENCES agent_runs (id) ON DELETE SET NULL,
    opportunity_id     BIGINT REFERENCES opportunities (id) ON DELETE CASCADE,
    kind               TEXT NOT NULL,                   -- 'prepare_documents','submit_proposal', ...
    payload            JSONB,
    requires_approval  BOOLEAN NOT NULL DEFAULT true,
    status             TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','approved','rejected','executed','failed')),
    approved_by        BIGINT REFERENCES users (id) ON DELETE SET NULL,
    approved_at        TIMESTAMPTZ,
    executed_at        TIMESTAMPTZ,
    result             JSONB,
    error              TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_agent_actions_opportunity ON agent_actions (opportunity_id);

CREATE TABLE opportunity_feedback (         -- learning loop
    id              BIGSERIAL PRIMARY KEY,
    opportunity_id  BIGINT NOT NULL REFERENCES opportunities (id) ON DELETE CASCADE,
    user_id         BIGINT REFERENCES users (id) ON DELETE SET NULL,
    kind            TEXT NOT NULL CHECK (kind IN ('accepted','rejected','participated','won','lost','disqualified')),
    reason          TEXT,
    price           NUMERIC(18,2),
    margin_pct      NUMERIC(7,4),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_opportunity_feedback_opportunity ON opportunity_feedback (opportunity_id);

CREATE TABLE conversations (
    id          BIGSERIAL PRIMARY KEY,
    company_id  BIGINT NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
    user_id     BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    title       TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_conversations_user ON conversations (user_id, updated_at DESC);

CREATE TABLE messages (
    id               BIGSERIAL PRIMARY KEY,
    conversation_id  BIGINT NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
    role             TEXT NOT NULL CHECK (role IN ('user','assistant','tool')),
    content          TEXT,
    tool_calls       JSONB,
    tool_call_id     TEXT,
    refs             JSONB,                             -- ProcurementRef[] rendered as cards
    model            TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_messages_conversation ON messages (conversation_id, id);
```

## Consequences

- Hot tables carry no raw JSON; reprocessing reads `source_payloads`. Storage for 8M items drops by roughly half versus the legacy `raw` column per row.
- Facet tables (`procurement_categories`, `_requirements`, `_cnaes`, `_embeddings`) make "all procurements requiring X" and vector search index-backed instead of JSONB scans.
- `procurement_id BIGINT` surrogate keys replace the 24-char `numero_controle_pncp` in every child table (smaller indexes, faster joins); `source_id` remains the public identifier used in URLs (`/procurement/[sourceId]`).
- Match engine stays on-demand in cycle 18; `matches`/`opportunities` are written from cycle 19 (proactive mode).
- The legacy database `plataforma-licitante_db` is dropped after the cutover is verified (operator step in ticket 84).
