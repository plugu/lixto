---
mode: production
routing_profile: cloud
parallel_default: parallel
---

# Lixto core — new data model, English, built from zero (cycle 18)

## What / why
Lixto pivoted from "licitação platform" to "AI procurement agent", but its data model is still the platform's: Portuguese names, PNCP-shaped flattened tables, redundant classification pipelines (Ollama setor/CNAE next to LLM enrichment), a legacy triage/deep `analise` pipeline next to the new match engine, and no agent-core entities (opportunity lifecycle, persisted matches, runs, actions, feedback). Carrying that forward is the technical debt we want to avoid now, while the codebase is two cycles old.

This cycle builds the Lixto core **from zero**: a new Postgres schema `lixto` (same `pg-shared` database, pgvector already present), English identifiers following the vision's entity names (`docs/VISION.md` §7 + agent core), populated exclusively by a new PNCP sync — **no data is copied from the legacy `public` schema**, including tenants (users re-sign up). The Python package and CLI become `lixto`; the web app, tools and chat are ported to the new schema; legacy tables and code are deleted at the end of the cycle.

Two PNCP domains are added because the agent needs them and the schema should be born with them: **Annual Procurement Plans (PCA)** — early signal of what an organ will buy before any edital exists (feeds proactive mode) — and **Contracts + amendments** — supplier history for competitor intelligence and for the customer's own track record (basis for technical-capacity certificates).

**Rename everything to Lixto** as part of the same cutover: GitHub repo `plataforma-licitante` → `lixto`; local checkout dir; Dokploy project/apps (`web` → `lixto-web`, `cli` → `lixto-cli`), deploy webhooks/secrets and schedules; Python package `plic` → `lixto`, CLI `plic` → `lixto`; Docker images/Dockerfiles; env var prefix `PLIC_` → `LIXTO_`; uploads volume; app title/brand strings still saying "Licitante". Because no data is migrated, the database itself is also new: `lixto` (owner role `lixto`) on `pg-shared`, using its default `public` schema — supersedes the earlier "schema `lixto` inside the old DB" choice; `plataforma-licitante_db` is dropped once the cutover is verified.

Guiding rules: process once, reuse globally; raw source payloads retained for reprocessing; deterministic first, LLM only where code can't; provider-abstracted LLM; the model never writes SQL; `source` abstraction on every ingested entity so a second portal is a new adapter, not a new schema.

## Primary user story
As a Lixto developer, I work against one coherent English data model that reads like the product vision — `procurement`, `procurement_item`, `procurement_document`, `enrichment`, `company`, `company_profile`, `opportunity`, `match`, `recommendation`, `agent_run`, `agent_action`, `procurement_plan`, `contract` — with no legacy tables, no duplicated classification, and PCA/contract data available for the agent; as an empresa user, after the cutover I sign up again and Lixto works exactly as before (search, profile, match, chat) on freshly synced data.

## Out of scope
- Copying or transforming any legacy data (PNCP or tenants) — the new schema starts empty and fills from PNCP
- Proactive digest/notifications, prepare/execute, learning-loop *logic* (the tables exist; the behaviours are later cycles)
- Atas de registro de preço, instrumentos de cobrança, órgão 360° profile, CNPJ enrichment of competitors — later domains
- Ollama classification pipelines (setor, two-stage CNAE) — deleted, not ported; CNAE comes from enrichment `cnae_candidates`
- Legacy triage/deep agents, `company_profile.md`, launchd scheduler — deleted
- Query-time semantic search, streaming chat, new UI screens for PCA/contracts (data only; chat tools may expose them)
- Second portal adapter (only the `source` abstraction ships)

## Success demo
Done when, on the fresh `lixto` database, `lixto backfill` + `lixto sync incremental` + `lixto sync pca` + `lixto sync contracts` populate procurements/items/documents/plans/contracts from PNCP, `lixto enrich run` fills `enrichment` (+embeddings), a user signs up, fills the profile, asks Lixto "quais licitações combinam com minha empresa?" on `/lixto` and gets scored cards — served from the renamed repo/Dokploy apps at their Lixto names, with no legacy tables, `plic` code or `PLIC_` env left, and ruff/pytest/tsc/vitest/build green.
