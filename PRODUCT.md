---
mode: mvp
routing_profile: cloud
parallel_default: sequential
---

# plataforma-licitante — PNCP ingestion agent

## What / why

Brazilian public tenders (licitações) are published centrally on PNCP (Portal Nacional de Contratações Públicas, pncp.gov.br — public API, no auth). There is no local, queryable mirror of them: answering "what is open, upcoming, or closed since Jan 1 2026" today means paging a slow, flaky public API. This project is a standalone ingestion agent that mirrors PNCP into a local PostgreSQL database and keeps it fresh on a schedule, so that filtering tools and an MCP server can later be built directly on the database.

Built from scratch (a prior project, `~/dev/licitacoes`, covers similar ground but its design is deliberately not reused; its measured PNCP behavior notes — rate limits, page caps, 5xx flakiness — remain useful reference).

## Primary user story

As the operator, I run one backfill and then let the agent run twice a day, so that my Postgres database always reflects every licitação published on PNCP since 2026-01-01 — including its items and edital document links — and I can query which are open, upcoming, or closed.

## Scope

- **Coverage:** all of Brazil — every entity, every UF, every modalidade published on PNCP.
- **Per licitação:** core metadata (órgão, modalidade, objeto, dates, values, status), all line items, and edital/anexo metadata with download URLs. Edital PDFs are **not** downloaded — URLs only.
- **Backfill:** everything published from 2026-01-01 onward.
- **Incremental:** scheduled run twice a day picks up new licitações and updates to existing ones (including status changes open → closed). Runs are idempotent and resumable after failure.
- **Status derivable by query:** open (proposal window active), upcoming (window not yet open), closed.

## Out of scope

- Filter/search tool and UI (later project, built on this DB).
- MCP server (later project, built on this DB).
- Downloading/storing edital PDF files.
- Matching, analysis, LLM triage, proposal submission (that's `licitacoes` territory).
- Multi-tenant anything.
- Data older than 2026-01-01.

## Success demo

Done when I can run the backfill plus at least one scheduled incremental run, then answer with plain SQL: "list licitações open, upcoming, and closed since 2026-01-01, filtered by modalidade/UF/órgão, with their items and edital URLs" — and counts plausibly match PNCP's own portal.
